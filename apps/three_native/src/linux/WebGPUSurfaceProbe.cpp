#include "RNWebGPUManager.h"
#include "SurfaceRegistry.h"
#include "valdi/linux/LinuxRuntime.hpp"
#include "valdi/runtime/JavaScript/JavaScriptRuntime.hpp"
#include "valdi/runtime/Runtime.hpp"
#include "valdi_core/cpp/Utils/StringCache.hpp"
#include "valdi_core/cpp/Utils/ValueArray.hpp"
#include "valdi_core/cpp/Utils/ValueUtils.hpp"

#include <SDL3/SDL.h>
#include <jsi/jsi.h>
#include <webgpu/webgpu.h>

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <limits>
#include <memory>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_set>
#include <vector>

#include <fcntl.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

namespace {

constexpr int kContextId = 7;
constexpr int kWidth = 720;
constexpr int kHeight = 720;

struct ProbeResult {
    std::mutex mutex;
    bool finished = false;
    bool presented = false;
    bool quitRequested = false;
    bool lifecycleReadySent = false;
    std::string message;
};

class FileBuffer final : public facebook::jsi::MutableBuffer {
public:
    explicit FileBuffer(const std::string& path, size_t maxBytes = 64 * 1024 * 1024) {
        std::ifstream file(path, std::ios::binary | std::ios::ate);
        if (!file) throw std::runtime_error("Cannot open native asset: " + path);
        const auto length = file.tellg();
        // The authored Dinner icon GLB is about 53 MiB. Keep a bounded read
        // while allowing the complete WorldOS icon catalog to load lazily.
        if (length < 0 || length > static_cast<std::streamoff>(maxBytes))
            throw std::runtime_error("Invalid native asset size: " + path);
        bytes_.resize(static_cast<size_t>(length));
        file.seekg(0);
        if (!file.read(reinterpret_cast<char*>(bytes_.data()), length))
            throw std::runtime_error("Cannot read native asset: " + path);
    }

    size_t size() const override { return bytes_.size(); }
    uint8_t* data() override { return bytes_.data(); }
    std::string text() const { return std::string(bytes_.begin(), bytes_.end()); }

private:
    std::vector<uint8_t> bytes_;
};

// SPAOS gives its World and Shell clients distinct private socket pairs. Keep
// both nonblocking: the renderer's JS thread must never wait for compositor IPC.
class NativeChannel final {
public:
    NativeChannel(int fd, size_t maxLine, size_t maxOutbox)
        : fd_(fd), maxLine_(maxLine), maxOutbox_(maxOutbox) {}
    ~NativeChannel() { if (fd_ >= 0) close(fd_); }

    NativeChannel(const NativeChannel&) = delete;
    NativeChannel& operator=(const NativeChannel&) = delete;

    bool isOpen() const { return fd_ >= 0; }

    void enableWorldArrival() { autoRevealWorld_ = true; }

    bool sendLine(const std::string& line) {
        std::lock_guard<std::mutex> lock(mutex_);
        return sendLineLocked(line);
    }

    // SPAOS can hide the World surface during an app arrival. WebGPU present
    // may then stall its JS draw loop, so service the channel on SDL's thread
    // too. Retain every line for JS; only the arrival reveal is handled here.
    void serviceWorldArrival() {
        std::lock_guard<std::mutex> lock(mutex_);
        readLocked(true);
    }

    std::string poll() {
        std::lock_guard<std::mutex> lock(mutex_);
        readLocked(autoRevealWorld_);
        std::string complete;
        complete.swap(ready_);
        return complete;
    }

private:
    bool sendLineLocked(const std::string& line) {
        if (fd_ < 0 || line.size() > maxLine_ ||
            outbound_.size() + line.size() + 1 > maxOutbox_ ||
            line.find('\n') != std::string::npos || line.find('\r') != std::string::npos)
            return false;
        outbound_ += line;
        outbound_ += '\n';
        flush();
        return fd_ >= 0;
    }

    void readLocked(bool revealArrival) {
        flush();
        if (fd_ < 0) return;
        char bytes[16384];
        for (int reads = 0; reads < 64; ++reads) {
            const ssize_t count = recv(fd_, bytes, sizeof(bytes), MSG_DONTWAIT);
            if (count > 0) {
                inbound_.append(bytes, static_cast<size_t>(count));
                if (inbound_.size() > 1024 * 1024) { closeChannel(); return; }
            } else if (count == 0) {
                closeChannel();
                break;
            } else if (errno == EINTR) {
                continue;
            } else if (errno == EAGAIN || errno == EWOULDBLOCK) {
                break;
            } else {
                closeChannel();
                break;
            }
        }
        const size_t end = inbound_.rfind('\n');
        if (end == std::string::npos) return;
        std::string complete = inbound_.substr(0, end + 1);
        inbound_.erase(0, end + 1);
        if (ready_.size() + complete.size() > 4 * 1024 * 1024) {
            closeChannel();
            return;
        }
        ready_ += complete;
        if (!revealArrival) return;
        size_t start = 0;
        while (start < complete.size()) {
            const auto newline = complete.find('\n', start);
            if (newline == std::string::npos) break;
            revealFromFloor(std::string_view(complete).substr(start, newline - start));
            start = newline + 1;
        }
    }

    void revealFromFloor(std::string_view line) {
        // Parse the authenticated World floor rather than guessing a space ID
        // from launch order. Ignore malformed or unrelated channel events.
        auto parsed = Valdi::correctJsonToValue(line);
        if (!parsed || !parsed.value().isMap()) return;
        const auto& event = parsed.value();
        if (event.getMapValue("type").toString() != "spaces") return;
        const auto spaces = event.getMapValue("spaces");
        if (!spaces.isArray()) return;
        int active = 0;
        int mapped = 0;
        const Valdi::Value* activeRow = nullptr;
        for (const auto& space : *spaces.getArray()) {
            if (!space.isMap()) continue;
            const auto id = space.getMapValue("id");
            const auto isActive = space.getMapValue("active");
            const auto windows = space.getMapValue("windows");
            if (!id.isInt() || id.toInt() < 1 || id.toInt() > 1000000 ||
                !isActive.isBool() || !isActive.toBool()) continue;
            active = id.toInt();
            activeRow = &space;
            if (windows.isInt() && windows.toInt() > 0) mapped = active;
            break;
        }
        if (active != arrivalSpace_) {
            arrivalSpace_ = active;
            revealedSpace_ = 0;
            revealedWindows_.clear();
        }
        if (mapped && mapped != revealedSpace_ && sendLineLocked(
                "{\"type\":\"reveal_windows\",\"space\":" + std::to_string(mapped) + "}")) {
            revealedSpace_ = mapped;
            std::fprintf(stderr, "Native World channel revealed mapped space %d\n", mapped);
        }
        if (!mapped || !activeRow) return;
        const auto seats = activeRow->getMapValue("seats");
        if (!seats.isArray()) return;
        for (const auto& seat : *seats.getArray()) {
            if (!seat.isMap()) continue;
            const auto window = seat.getMapValue("window");
            if ((!window.isInt() && !window.isLong()) || window.toLong() < 1 ||
                revealedWindows_.count(window.toLong())) continue;
            const auto id = window.toLong();
            if (sendLineLocked("{\"type\":\"reveal_windows\",\"space\":" +
                               std::to_string(mapped) + ",\"window\":" +
                               std::to_string(id) + "}")) {
                revealedWindows_.insert(id);
                std::fprintf(stderr, "Native World channel revealed mapped window %lld in space %d\n",
                             static_cast<long long>(id), mapped);
            }
        }
    }

    void closeChannel() {
        if (fd_ >= 0) close(fd_);
        fd_ = -1;
        inbound_.clear();
        outbound_.clear();
        ready_.clear();
    }
    void flush() {
        while (fd_ >= 0 && !outbound_.empty()) {
            const ssize_t count = send(fd_, outbound_.data(), outbound_.size(),
                                       MSG_DONTWAIT | MSG_NOSIGNAL);
            if (count > 0) outbound_.erase(0, static_cast<size_t>(count));
            else if (count < 0 && errno == EINTR) continue;
            else if (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) break;
            else { closeChannel(); break; }
        }
    }
    int fd_;
    std::mutex mutex_;
    size_t maxLine_;
    size_t maxOutbox_;
    std::string inbound_;
    std::string outbound_;
    std::string ready_;
    int arrivalSpace_ = 0;
    int revealedSpace_ = 0;
    std::unordered_set<int64_t> revealedWindows_;
    bool autoRevealWorld_ = false;
};

std::shared_ptr<NativeChannel> channelFromEnvironment(const char* name,
                                                      size_t maxLine, size_t maxOutbox) {
    const char* raw = std::getenv(name);
    if (!raw || !*raw) return {};
    char* end = nullptr;
    errno = 0;
    const long parsed = std::strtol(raw, &end, 10);
    if (errno || *end || parsed < 3 || parsed > std::numeric_limits<int>::max()) return {};
    const int fd = static_cast<int>(parsed);
    if (fcntl(fd, F_GETFD) < 0) return {};
    const int flags = fcntl(fd, F_GETFL);
    if (flags < 0 || fcntl(fd, F_SETFL, flags | O_NONBLOCK) < 0) return {};
    return std::make_shared<NativeChannel>(fd, maxLine, maxOutbox);
}

std::shared_ptr<NativeChannel> channelFromLocalSocket(const char* raw,
                                                     size_t maxLine, size_t maxOutbox,
                                                     const char* tokenName = nullptr) {
    sockaddr_un address{};
    if (!raw || raw[0] != '/' || std::strlen(raw) >= sizeof(address.sun_path)) return {};
    const int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fd < 0) return {};
    address.sun_family = AF_UNIX;
    std::strncpy(address.sun_path, raw, sizeof(address.sun_path) - 1);
    if (connect(fd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) < 0) {
        close(fd);
        return {};
    }
    const int flags = fcntl(fd, F_GETFL);
    if (flags < 0 || fcntl(fd, F_SETFL, flags | O_NONBLOCK) < 0) {
        close(fd);
        return {};
    }
    auto channel = std::make_shared<NativeChannel>(fd, maxLine, maxOutbox);
    if (tokenName) {
        const char* token = std::getenv(tokenName);
        if (!token || std::strlen(token) != 64 ||
            !std::all_of(token, token + 64, [](unsigned char c) { return std::isxdigit(c); }))
            return {};
        if (!channel->sendLine(std::string("{\"type\":\"ui_auth\",\"token\":\"") + token + "\"}"))
            return {};
    }
    return channel;
}

std::shared_ptr<NativeChannel> worldChannelFromEnvironment() {
    auto channel = channelFromEnvironment("SPAOS_APP_CHANNEL_FD", 256 * 1024, 1024 * 1024);
    if (!channel) return {};
    channel->enableWorldArrival();
    channel->sendLine("{\"type\":\"hello\",\"protocol\":1}");
    return channel;
}

std::string worldCallName(facebook::jsi::Runtime& js, const facebook::jsi::Value& value,
                          const char* kind) {
    if (!value.isString()) throw facebook::jsi::JSError(js, kind);
    const auto name = value.getString(js).utf8(js);
    if (name.empty() || name.size() > 128 ||
        !std::all_of(name.begin(), name.end(), [](unsigned char c) {
            return std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == ':';
        })) throw facebook::jsi::JSError(js, kind);
    return name;
}

int worldCoordinate(facebook::jsi::Runtime& js, const facebook::jsi::Value& value) {
    if (!value.isNumber()) throw facebook::jsi::JSError(js, "Expected a WorldOS tile coordinate");
    const double number = value.getNumber();
    if (!std::isfinite(number) || number < -10000 || number > 10000 || std::floor(number) != number)
        throw facebook::jsi::JSError(js, "Invalid WorldOS tile coordinate");
    return static_cast<int>(number);
}

std::string lifecycleIdentifier(facebook::jsi::Runtime& js,
                                const facebook::jsi::Value& value) {
    if (!value.isString()) throw facebook::jsi::JSError(js, "Expected SPAOS lifecycle identity");
    const auto id = value.getString(js).utf8(js);
    if (id.empty() || id.size() > 128 ||
        !std::all_of(id.begin(), id.end(), [](unsigned char c) {
            return std::isalnum(c) || c == '-' || c == '_' || c == '.';
        })) throw facebook::jsi::JSError(js, "Invalid SPAOS lifecycle identity");
    return id;
}

std::string assetPath(facebook::jsi::Runtime& js,
                      const facebook::jsi::Value* args, size_t count,
                      const std::string& root) {
    if (count != 1 || !args[0].isString()) throw facebook::jsi::JSError(js, "Expected asset filename");
    const auto name = args[0].getString(js).utf8(js);
    if (name.empty() || name[0] == '.' ||
        !std::all_of(name.begin(), name.end(), [](unsigned char c) {
            return std::isalnum(c) || c == '.' || c == '_' || c == '-';
        })) throw facebook::jsi::JSError(js, "Invalid asset filename");
    return root + "/" + name;
}

} // namespace

int main(int argc, char** argv) {
    std::string script;
    std::string scriptPath;
    bool interactive = false;
    bool shellClient = false;
    int frameLimit = 1;
    for (int i = 1; i < argc; ++i) {
        const std::string arg(argv[i]);
        if (arg == "--interactive") {
            interactive = true;
            frameLimit = 0;
        } else if (arg == "--shell-client") {
            shellClient = true;
        } else if (arg.rfind("--frames=", 0) == 0) {
            frameLimit = std::atoi(arg.c_str() + 9);
            if (frameLimit < 1 || frameLimit > 100000) {
                std::fprintf(stderr, "--frames must be between 1 and 100000\n");
                return 2;
            }
        } else if (scriptPath.empty()) {
            scriptPath = arg;
        } else {
            std::fprintf(stderr, "Usage: %s [--frames=N|--interactive] [--shell-client] [bundled-javascript.js]\n", argv[0]);
            return 2;
        }
    }
    if (interactive) frameLimit = 0;
    const bool directShell = std::getenv("SPAOS_SHELL_CHANNEL_FD") != nullptr;
    const bool localShell = std::getenv("VALDI_SHELL_UI_SOCKET") != nullptr;
    if (shellClient && (scriptPath.empty() || directShell == localShell ||
                        std::getenv("SPAOS_APP_CHANNEL_FD"))) {
        std::fprintf(stderr, "--shell-client requires exactly one Shell or local UI channel\n");
        return 2;
    }
    if (!scriptPath.empty()) {
        std::ifstream source(scriptPath);
        if (!source) {
            std::fprintf(stderr, "Cannot open JavaScript bundle: %s\n", scriptPath.c_str());
            return 2;
        }
        std::ostringstream contents;
        contents << source.rdbuf();
        script = contents.str();
    }
    // A dock press also focuses this Wayland window. SDL's default drops that
    // first press, which would make the first grip drag or button click inert.
    if (shellClient) SDL_SetHint(SDL_HINT_MOUSE_FOCUS_CLICKTHROUGH, "1");
    if (!SDL_Init(SDL_INIT_VIDEO)) {
        std::fprintf(stderr, "SDL_Init: %s\n", SDL_GetError());
        return 1;
    }
    const char* title = shellClient ? "spaos-space-ui" : std::getenv("WORLD_OS_NATIVE_FLOOR")
        ? "WorldOS live floor - Valdi Three/Dawn"
        : std::getenv("WORLD_OS_NATIVE_STATE")
        ? "WorldOS live layout - Valdi Three/Dawn"
        : "WorldOS home scene - Valdi Three/Dawn";
    SDL_Window* window = SDL_CreateWindow(title, kWidth, kHeight,
        SDL_WINDOW_VULKAN | SDL_WINDOW_RESIZABLE |
        (shellClient ? SDL_WINDOW_TRANSPARENT | SDL_WINDOW_BORDERLESS : 0));
    if (window == nullptr) {
        std::fprintf(stderr, "SDL_CreateWindow: %s\n", SDL_GetError());
        SDL_Quit();
        return 1;
    }
    if (interactive && !shellClient && !SDL_StartTextInput(window))
        std::fprintf(stderr, "SDL_StartTextInput: %s\n", SDL_GetError());
    SDL_PropertiesID properties = SDL_GetWindowProperties(window);
    void* display = SDL_GetPointerProperty(properties, SDL_PROP_WINDOW_WAYLAND_DISPLAY_POINTER, nullptr);
    void* wlSurface = SDL_GetPointerProperty(properties, SDL_PROP_WINDOW_WAYLAND_SURFACE_POINTER, nullptr);
    if (display == nullptr || wlSurface == nullptr) {
        std::fprintf(stderr, "SDL did not provide a Wayland surface\n");
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    auto standalone = ValdiLinux::createLinuxRuntime(false, true, snap::valdi_core::JavaScriptEngineType::Hermes);
    standalone->setupJsRuntime({});
    auto* runtime = standalone->getRuntime().getJavaScriptRuntime();
    auto result = std::make_shared<ProbeResult>();
    auto worldChannel = script.empty() || shellClient
        ? std::shared_ptr<NativeChannel>() : worldChannelFromEnvironment();
    auto agentChannel = script.empty() || shellClient
        ? std::shared_ptr<NativeChannel>()
        : channelFromLocalSocket(std::getenv("WORLD_OS_NATIVE_AGENT_SOCKET"),
                                 256 * 1024, 1024 * 1024);
    auto shellChannel = shellClient
        ? directShell
            ? channelFromEnvironment("SPAOS_SHELL_CHANNEL_FD", 256 * 1024, 1024 * 1024)
            : channelFromLocalSocket(std::getenv("VALDI_SHELL_UI_SOCKET"),
                                     256 * 1024, 1024 * 1024, "VALDI_SHELL_UI_TOKEN")
        : std::shared_ptr<NativeChannel>();
    if (shellClient && !shellChannel) {
        std::fprintf(stderr, "Cannot open SPAOS shell channel\n");
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 2;
    }
    std::unique_ptr<rnwgpu::RNWebGPUManager> webgpu;
    bool installed = false;

    runtime->dispatchSynchronouslyOnJsThread(STRING_LITERAL("install_webgpu_wayland_surface"),
                                             [&](Valdi::JavaScriptEntryParameters& entry) {
        auto* jsi = entry.jsContext.getJsiRuntime();
        if (jsi == nullptr) return;
        webgpu = std::make_unique<rnwgpu::RNWebGPUManager>(jsi, nullptr, nullptr);

        WGPUSurfaceSourceWaylandSurface source = WGPU_SURFACE_SOURCE_WAYLAND_SURFACE_INIT;
        source.display = display;
        source.surface = wlSurface;
        WGPUSurfaceDescriptor descriptor = WGPU_SURFACE_DESCRIPTOR_INIT;
        descriptor.nextInChain = &source.chain;
        WGPUSurface raw = wgpuInstanceCreateSurface(webgpu->_gpu.Get(), &descriptor);
        if (raw == nullptr) return;
        rnwgpu::SurfaceRegistry::getInstance().attachSurface(
            kContextId, webgpu->_gpu, kWidth, kHeight, wlSurface,
            wgpu::Surface::Acquire(raw), {});
        installed = true;

        auto done = facebook::jsi::Function::createFromHostFunction(
            *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__webgpuSurfaceDone"), 2,
            [result, worldChannel](facebook::jsi::Runtime& js,
                     const facebook::jsi::Value&,
                     const facebook::jsi::Value* args,
                     size_t count) -> facebook::jsi::Value {
                std::lock_guard<std::mutex> lock(result->mutex);
                result->presented = count > 0 && args[0].isBool() && args[0].getBool();
                if (count > 1 && args[1].isString()) result->message = args[1].getString(js).utf8(js);
                result->finished = true;
                if (result->presented && worldChannel && !result->lifecycleReadySent)
                    result->lifecycleReadySent = worldChannel->sendLine(
                        "{\"type\":\"lifecycle_ready\"}");
                return facebook::jsi::Value::undefined();
            });
        jsi->global().setProperty(*jsi, "__webgpuSurfaceDone", std::move(done));
        if (!script.empty()) {
            jsi->global().setProperty(*jsi, "__nativeFrameLimit", frameLimit);
            auto requestQuit = facebook::jsi::Function::createFromHostFunction(
                *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeRequestQuit"), 0,
                [result](facebook::jsi::Runtime&, const facebook::jsi::Value&,
                         const facebook::jsi::Value*, size_t) -> facebook::jsi::Value {
                    std::lock_guard<std::mutex> lock(result->mutex);
                    result->quitRequested = true;
                    return facebook::jsi::Value::undefined();
                });
            jsi->global().setProperty(*jsi, "__nativeRequestQuit", std::move(requestQuit));
            if (worldChannel) {
                auto pollWorld = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeWorldPoll"), 0,
                    [worldChannel](facebook::jsi::Runtime& js, const facebook::jsi::Value&,
                                   const facebook::jsi::Value*, size_t) -> facebook::jsi::Value {
                        return facebook::jsi::String::createFromUtf8(js, worldChannel->poll());
                    });
                jsi->global().setProperty(*jsi, "__nativeWorldPoll", std::move(pollWorld));
                auto lifecycleStatus = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeWorldLifecycleStatus"), 1,
                    [worldChannel](facebook::jsi::Runtime& js, const facebook::jsi::Value&,
                                   const facebook::jsi::Value* args, size_t count) -> facebook::jsi::Value {
                        if (count != 1) throw facebook::jsi::JSError(js, "Expected lifecycle request id");
                        const auto id = lifecycleIdentifier(js, args[0]);
                        return facebook::jsi::Value(worldChannel->sendLine(
                            "{\"type\":\"lifecycle\",\"id\":\"" + id +
                            "\",\"request\":{\"op\":\"status\"}}"));
                    });
                jsi->global().setProperty(*jsi, "__nativeWorldLifecycleStatus", std::move(lifecycleStatus));
                auto lifecycleRestart = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeWorldLifecycleRestart"), 3,
                    [worldChannel](facebook::jsi::Runtime& js, const facebook::jsi::Value&,
                                   const facebook::jsi::Value* args, size_t count) -> facebook::jsi::Value {
                        if (count != 3) throw facebook::jsi::JSError(js, "Expected lifecycle id, session and request id");
                        const auto id = lifecycleIdentifier(js, args[0]);
                        const auto session = lifecycleIdentifier(js, args[1]);
                        const auto requestId = lifecycleIdentifier(js, args[2]);
                        return facebook::jsi::Value(worldChannel->sendLine(
                            "{\"type\":\"lifecycle\",\"id\":\"" + id +
                            "\",\"request\":{\"op\":\"submit\",\"session\":\"" + session +
                            "\",\"request_id\":\"" + requestId +
                            "\",\"target\":\"world\",\"action\":\"restart\"}}"));
                    });
                jsi->global().setProperty(*jsi, "__nativeWorldLifecycleRestart", std::move(lifecycleRestart));
                auto enterWorld = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeWorldEnter"), 2,
                    [worldChannel](facebook::jsi::Runtime& js, const facebook::jsi::Value&,
                                   const facebook::jsi::Value* args, size_t count) -> facebook::jsi::Value {
                        if (count != 2) throw facebook::jsi::JSError(js, "Expected WorldOS tile");
                        const int x = worldCoordinate(js, args[0]);
                        const int z = worldCoordinate(js, args[1]);
                        return facebook::jsi::Value(worldChannel->sendLine(
                            "{\"type\":\"enter\",\"at\":{\"x\":" + std::to_string(x) +
                            ",\"z\":" + std::to_string(z) + "}}"));
                    });
                jsi->global().setProperty(*jsi, "__nativeWorldEnter", std::move(enterWorld));
                auto leaveWorld = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeWorldLeave"), 0,
                    [worldChannel](facebook::jsi::Runtime&, const facebook::jsi::Value&,
                                   const facebook::jsi::Value*, size_t) -> facebook::jsi::Value {
                        return facebook::jsi::Value(worldChannel->sendLine("{\"type\":\"leave\"}"));
                    });
                jsi->global().setProperty(*jsi, "__nativeWorldLeave", std::move(leaveWorld));
                auto releaseWorld = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeWorldRelease"), 1,
                    [worldChannel](facebook::jsi::Runtime& js, const facebook::jsi::Value&,
                                   const facebook::jsi::Value* args, size_t count) -> facebook::jsi::Value {
                        if (count != 1 || !args[0].isNumber())
                            throw facebook::jsi::JSError(js, "Expected WorldOS space id");
                        const double space = args[0].getNumber();
                        if (!std::isfinite(space) || space < 1 || space > 1000000 ||
                            std::floor(space) != space)
                            throw facebook::jsi::JSError(js, "Invalid WorldOS space id");
                        return facebook::jsi::Value(worldChannel->sendLine(
                            "{\"type\":\"release_windows\",\"space\":" +
                            std::to_string(static_cast<int>(space)) + "}"));
                    });
                jsi->global().setProperty(*jsi, "__nativeWorldRelease", std::move(releaseWorld));
                auto revealWorld = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeWorldReveal"), 1,
                    [worldChannel](facebook::jsi::Runtime& js, const facebook::jsi::Value&,
                                   const facebook::jsi::Value* args, size_t count) -> facebook::jsi::Value {
                        if (count != 1 || !args[0].isNumber())
                            throw facebook::jsi::JSError(js, "Expected WorldOS space id");
                        const double space = args[0].getNumber();
                        if (!std::isfinite(space) || space < 1 || space > 1000000 ||
                            std::floor(space) != space)
                            throw facebook::jsi::JSError(js, "Invalid WorldOS space id");
                        return facebook::jsi::Value(worldChannel->sendLine(
                            "{\"type\":\"reveal_windows\",\"space\":" +
                            std::to_string(static_cast<int>(space)) + "}"));
                    });
                jsi->global().setProperty(*jsi, "__nativeWorldReveal", std::move(revealWorld));
                auto openWorld = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeWorldOpen"), 3,
                    [worldChannel](facebook::jsi::Runtime& js, const facebook::jsi::Value&,
                                   const facebook::jsi::Value* args, size_t count) -> facebook::jsi::Value {
                        if (count != 3 || !args[0].isString())
                            throw facebook::jsi::JSError(js, "Expected WorldOS app key and tile");
                        const std::string key = args[0].getString(js).utf8(js);
                        if (key.empty() || key.size() > 128 ||
                            !std::all_of(key.begin(), key.end(), [](unsigned char c) {
                                return std::isalnum(c) || c == '.' || c == '_' || c == '-';
                            })) throw facebook::jsi::JSError(js, "Invalid WorldOS app key");
                        const int x = worldCoordinate(js, args[1]);
                        const int z = worldCoordinate(js, args[2]);
                        return facebook::jsi::Value(worldChannel->sendLine(
                            "{\"type\":\"open\",\"app\":\"" + key +
                            "\",\"at\":{\"x\":" + std::to_string(x) +
                            ",\"z\":" + std::to_string(z) + "}}"));
                    });
                jsi->global().setProperty(*jsi, "__nativeWorldOpen", std::move(openWorld));
                auto callWorld = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeWorldCall"), 4,
                    [worldChannel](facebook::jsi::Runtime& js, const facebook::jsi::Value&,
                                   const facebook::jsi::Value* args, size_t count) -> facebook::jsi::Value {
                        if (count != 4 || !args[1].isString() || !args[3].isBool())
                            throw facebook::jsi::JSError(js, "Expected WorldOS verb, arguments, call id and service flag");
                        const auto verb = worldCallName(js, args[0], "Invalid WorldOS verb");
                        const auto id = worldCallName(js, args[2], "Invalid WorldOS call id");
                        const auto payload = args[1].getString(js).utf8(js);
                        if (payload.size() > 128 * 1024 || payload.empty() || payload.front() != '{' ||
                            payload.back() != '}' || payload.find('\n') != std::string::npos ||
                            payload.find('\r') != std::string::npos)
                            throw facebook::jsi::JSError(js, "Invalid WorldOS verb arguments");
                        const char* type = args[3].getBool() ? "call_headless" : "call";
                        return facebook::jsi::Value(worldChannel->sendLine(
                            std::string("{\"type\":\"") + type + "\",\"verb\":\"" + verb +
                            "\",\"args\":" + payload + ",\"callId\":\"" + id + "\"}"));
                    });
                jsi->global().setProperty(*jsi, "__nativeWorldCall", std::move(callWorld));
            }
            if (agentChannel) {
                auto pollAgent = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeAgentPoll"), 0,
                    [agentChannel](facebook::jsi::Runtime& js, const facebook::jsi::Value&,
                                   const facebook::jsi::Value*, size_t) -> facebook::jsi::Value {
                        return facebook::jsi::String::createFromUtf8(js, agentChannel->poll());
                    });
                jsi->global().setProperty(*jsi, "__nativeAgentPoll", std::move(pollAgent));
                auto sendAgent = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeAgentSend"), 1,
                    [agentChannel](facebook::jsi::Runtime& js, const facebook::jsi::Value&,
                                   const facebook::jsi::Value* args, size_t count) -> facebook::jsi::Value {
                        if (count != 1 || !args[0].isString())
                            throw facebook::jsi::JSError(js, "Expected one native agent frame");
                        return facebook::jsi::Value(agentChannel->sendLine(args[0].getString(js).utf8(js)));
                    });
                jsi->global().setProperty(*jsi, "__nativeAgentSend", std::move(sendAgent));
                auto agentConnected = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeAgentConnected"), 0,
                    [agentChannel](facebook::jsi::Runtime&, const facebook::jsi::Value&,
                                   const facebook::jsi::Value*, size_t) -> facebook::jsi::Value {
                        return facebook::jsi::Value(agentChannel->isOpen());
                    });
                jsi->global().setProperty(*jsi, "__nativeAgentConnected", std::move(agentConnected));
            }
            if (shellChannel) {
                auto pollShell = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeShellPoll"), 0,
                    [shellChannel](facebook::jsi::Runtime& js, const facebook::jsi::Value&,
                                   const facebook::jsi::Value*, size_t) -> facebook::jsi::Value {
                        return facebook::jsi::String::createFromUtf8(js, shellChannel->poll());
                    });
                jsi->global().setProperty(*jsi, "__nativeShellPoll", std::move(pollShell));
                auto sendShell = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeShellSend"), 1,
                    [shellChannel](facebook::jsi::Runtime& js, const facebook::jsi::Value&,
                                   const facebook::jsi::Value* args, size_t count) -> facebook::jsi::Value {
                        if (count != 1 || !args[0].isString())
                            throw facebook::jsi::JSError(js, "Expected one SPAOS shell request");
                        return facebook::jsi::Value(shellChannel->sendLine(args[0].getString(js).utf8(js)));
                    });
                jsi->global().setProperty(*jsi, "__nativeShellSend", std::move(sendShell));
                auto shellConnected = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeShellConnected"), 0,
                    [shellChannel](facebook::jsi::Runtime&, const facebook::jsi::Value&,
                                   const facebook::jsi::Value*, size_t) -> facebook::jsi::Value {
                        return facebook::jsi::Value(shellChannel->isOpen());
                    });
                jsi->global().setProperty(*jsi, "__nativeShellConnected", std::move(shellConnected));
            }
            if (const char* statePath = std::getenv("WORLD_OS_NATIVE_STATE")) {
                const std::string path(statePath);
                auto readState = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeReadShellState"), 0,
                    [path](facebook::jsi::Runtime& js, const facebook::jsi::Value&,
                           const facebook::jsi::Value*, size_t) -> facebook::jsi::Value {
                        try {
                            return facebook::jsi::String::createFromUtf8(js, FileBuffer(path).text());
                        } catch (const std::exception& error) {
                            throw facebook::jsi::JSError(js, error.what());
                        }
                    });
                jsi->global().setProperty(*jsi, "__nativeReadShellState", std::move(readState));
            }
            if (const char* rosterPath = std::getenv("WORLD_OS_NATIVE_ROSTER")) {
                const std::string path(rosterPath);
                auto readRoster = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeReadPeopleRoster"), 0,
                    [path](facebook::jsi::Runtime& js, const facebook::jsi::Value&,
                           const facebook::jsi::Value*, size_t) -> facebook::jsi::Value {
                        try {
                            return facebook::jsi::String::createFromUtf8(js,
                                FileBuffer(path, 2 * 1024 * 1024).text());
                        } catch (const std::exception& error) {
                            throw facebook::jsi::JSError(js, error.what());
                        }
                    });
                jsi->global().setProperty(*jsi, "__nativeReadPeopleRoster", std::move(readRoster));
            }
            if (const char* floorPath = std::getenv("WORLD_OS_NATIVE_FLOOR")) {
                const std::string path(floorPath);
                auto readFloor = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeReadShellFloor"), 0,
                    [path](facebook::jsi::Runtime& js, const facebook::jsi::Value&,
                           const facebook::jsi::Value*, size_t) -> facebook::jsi::Value {
                        try {
                            return facebook::jsi::String::createFromUtf8(js, FileBuffer(path).text());
                        } catch (const std::exception& error) {
                            throw facebook::jsi::JSError(js, error.what());
                        }
                    });
                jsi->global().setProperty(*jsi, "__nativeReadShellFloor", std::move(readFloor));
            }
            if (const char* previewRoot = std::getenv("WORLD_OS_NATIVE_PREVIEWS")) {
                const std::string root(previewRoot);
                auto readPreview = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeReadShellPreview"), 4,
                    [root](facebook::jsi::Runtime& js, const facebook::jsi::Value&,
                           const facebook::jsi::Value* args, size_t count) -> facebook::jsi::Value {
                        if (count != 4) throw facebook::jsi::JSError(js, "Expected preview coordinates and size");
                        uint64_t values[4];
                        for (size_t i = 0; i < 4; ++i) {
                            if (!args[i].isNumber()) throw facebook::jsi::JSError(js, "Invalid preview coordinate");
                            const double value = args[i].getNumber();
                            if (!std::isfinite(value) || value < 1 || value > 9007199254740991.0 ||
                                std::floor(value) != value)
                                throw facebook::jsi::JSError(js, "Invalid preview coordinate");
                            values[i] = static_cast<uint64_t>(value);
                        }
                        if (values[0] > 1000000 || values[2] > 4096 || values[3] > 4096 ||
                            values[2] * values[3] > 8 * 1024 * 1024)
                            throw facebook::jsi::JSError(js, "Invalid preview dimensions");
                        const auto path = root + "/" + std::to_string(values[0]) + "." +
                                          std::to_string(values[1]) + ".rgba";
                        try {
                            auto bytes = std::make_shared<FileBuffer>(path);
                            if (bytes->size() != values[2] * values[3] * 4)
                                throw std::runtime_error("Preview byte count does not match dimensions");
                            return facebook::jsi::ArrayBuffer(js, bytes);
                        } catch (const std::exception& error) {
                            throw facebook::jsi::JSError(js, error.what());
                        }
                    });
                jsi->global().setProperty(*jsi, "__nativeReadShellPreview", std::move(readPreview));
            }
            if (const char* capturePath = std::getenv("THREE_NATIVE_LINUX_CAPTURE")) {
                const std::string path(capturePath);
                auto saveFrame = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeSaveFrame"), 5,
                    [path](facebook::jsi::Runtime& js, const facebook::jsi::Value&,
                           const facebook::jsi::Value* args, size_t count) -> facebook::jsi::Value {
                        if (count != 5 || !args[0].isObject() || !args[1].isNumber() ||
                            !args[2].isNumber() || !args[3].isNumber() || !args[4].isString())
                            throw facebook::jsi::JSError(js, "Invalid frame capture arguments");
                        auto buffer = args[0].getObject(js).getArrayBuffer(js);
                        const int width = static_cast<int>(args[1].getNumber());
                        const int height = static_cast<int>(args[2].getNumber());
                        const int stride = static_cast<int>(args[3].getNumber());
                        const auto format = args[4].getString(js).utf8(js);
                        if (width < 1 || width > 4096 || height < 1 || height > 4096 ||
                            stride < width * 4 || static_cast<size_t>(stride) * height > buffer.size(js))
                            throw facebook::jsi::JSError(js, "Invalid frame capture dimensions");
                        std::ofstream output(path, std::ios::binary);
                        if (!output) throw facebook::jsi::JSError(js, "Cannot open capture output");
                        output << "P6\n" << width << " " << height << "\n255\n";
                        const auto* pixels = buffer.data(js);
                        const bool bgra = format.rfind("bgra", 0) == 0;
                        for (int y = 0; y < height; ++y) {
                            for (int x = 0; x < width; ++x) {
                                const auto* pixel = pixels + static_cast<size_t>(y) * stride + x * 4;
                                const char rgb[3] = {static_cast<char>(pixel[bgra ? 2 : 0]),
                                                     static_cast<char>(pixel[1]),
                                                     static_cast<char>(pixel[bgra ? 0 : 2])};
                                output.write(rgb, 3);
                            }
                        }
                        if (!output) throw facebook::jsi::JSError(js, "Frame capture write failed");
                        return facebook::jsi::Value::undefined();
                    });
                jsi->global().setProperty(*jsi, "__nativeSaveFrame", std::move(saveFrame));
            }
            if (const char* assetRoot = std::getenv("WORLD_OS_NATIVE_ASSETS")) {
                const std::string root(assetRoot);
                auto readBytes = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeReadAsset"), 1,
                    [root](facebook::jsi::Runtime& js, const facebook::jsi::Value&,
                           const facebook::jsi::Value* args, size_t count) -> facebook::jsi::Value {
                        try {
                            return facebook::jsi::ArrayBuffer(js,
                                std::make_shared<FileBuffer>(assetPath(js, args, count, root)));
                        } catch (const std::exception& error) {
                            throw facebook::jsi::JSError(js, error.what());
                        }
                    });
                jsi->global().setProperty(*jsi, "__nativeReadAsset", std::move(readBytes));
                auto readText = facebook::jsi::Function::createFromHostFunction(
                    *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__nativeReadTextAsset"), 1,
                    [root](facebook::jsi::Runtime& js, const facebook::jsi::Value&,
                           const facebook::jsi::Value* args, size_t count) -> facebook::jsi::Value {
                        try {
                            return facebook::jsi::String::createFromUtf8(js,
                                FileBuffer(assetPath(js, args, count, root)).text());
                        } catch (const std::exception& error) {
                            throw facebook::jsi::JSError(js, error.what());
                        }
                    });
                jsi->global().setProperty(*jsi, "__nativeReadTextAsset", std::move(readText));
            }
            auto stage = facebook::jsi::Function::createFromHostFunction(
                *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__webgpuSurfaceStage"), 1,
                [](facebook::jsi::Runtime& js, const facebook::jsi::Value&,
                   const facebook::jsi::Value* args, size_t count) -> facebook::jsi::Value {
                    if (count && args[0].isString())
                        std::fprintf(stderr, "Three/Hermes: %s\n", args[0].getString(js).utf8(js).c_str());
                    return facebook::jsi::Value::undefined();
                });
            jsi->global().setProperty(*jsi, "__webgpuSurfaceStage", std::move(stage));
            entry.jsContext.evaluate(script, scriptPath, entry.exceptionTracker);
            return;
        }
        entry.jsContext.evaluate(
            "RNWebGPU.gpu.requestAdapter()"
            ".then(adapter => adapter.requestDevice())"
            ".then(device => {"
            "  const context = RNWebGPU.MakeWebGPUCanvasContext(7, 720, 720);"
            "  const format = RNWebGPU.gpu.getPreferredCanvasFormat();"
            "  context.configure({device, format,"
            "    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC});"
            "  const texture = context.getCurrentTexture();"
            "  const encoder = device.createCommandEncoder();"
            "  const pass = encoder.beginRenderPass({colorAttachments:[{"
            "    view: texture.createView(),"
            "    loadOp:'clear', storeOp:'store', clearValue:{r:0.12,g:0.35,b:0.72,a:1}"
            "  }]});"
            "  pass.end();"
            "  const readback = device.createBuffer({size:256,"
            "    usage:GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});"
            "  encoder.copyTextureToBuffer({texture,origin:{x:360,y:360,z:0}},"
            "    {buffer:readback,bytesPerRow:256},"
            "    {width:1,height:1,depthOrArrayLayers:1});"
            "  device.queue.submit([encoder.finish()]);"
            "  context.present();"
            "  return readback.mapAsync(GPUMapMode.READ).then(() => {"
            "    const p = new Uint8Array(readback.getMappedRange());"
            "    const rgb = format.indexOf('bgra') === 0 ? [p[2],p[1],p[0]] : [p[0],p[1],p[2]];"
            "    const valid = Math.abs(rgb[0]-31)<6 && Math.abs(rgb[1]-89)<6 &&"
            "      Math.abs(rgb[2]-184)<6 && p[3]>250;"
            "    __webgpuSurfaceDone(valid, 'GPU pixel '+rgb.join(',')+' / '+p[3]);"
            "    readback.unmap();"
            "  });"
            "})"
            ".catch(error => __webgpuSurfaceDone(false, String(error)))",
            "WebGPUSurfaceProbe", entry.exceptionTracker);
    });

    const auto deadline = std::chrono::steady_clock::now() +
                          std::chrono::seconds(std::max(15, frameLimit / 30 + 10));
    bool complete = false;
    bool quit = false;
    while (interactive || std::chrono::steady_clock::now() < deadline) {
        SDL_Event event;
        while (SDL_PollEvent(&event)) {
            if (event.type == SDL_EVENT_QUIT || event.type == SDL_EVENT_WINDOW_CLOSE_REQUESTED ||
                (event.type == SDL_EVENT_KEY_DOWN && event.key.key == SDLK_ESCAPE &&
                 !worldChannel && !shellClient)) {
                quit = true;
                break;
            }
            if (worldChannel && event.type == SDL_EVENT_KEY_DOWN && event.key.key == SDLK_ESCAPE) {
                runtime->dispatchSynchronouslyOnJsThread(STRING_LITERAL("world_home_back"),
                    [&](Valdi::JavaScriptEntryParameters& entry) {
                        auto* js = entry.jsContext.getJsiRuntime();
                        auto handler = js->global().getProperty(*js, "__worldBack");
                        if (handler.isObject())
                            handler.asObject(*js).asFunction(*js).call(*js);
                    });
            }
            if (interactive && (event.type == SDL_EVENT_MOUSE_WHEEL ||
                                event.type == SDL_EVENT_KEY_DOWN)) {
                const char* navigation = nullptr;
                double amount = 1;
                if (event.type == SDL_EVENT_MOUSE_WHEEL && event.wheel.y != 0) {
                    navigation = "zoom";
                    amount = event.wheel.y;
                } else if (event.type == SDL_EVENT_KEY_DOWN) {
                    switch (event.key.key) {
                        case SDLK_LEFT: navigation = "left"; break;
                        case SDLK_RIGHT: navigation = "right"; break;
                        case SDLK_UP: navigation = "up"; break;
                        case SDLK_DOWN: navigation = "down"; break;
                        case SDLK_HOME: navigation = "recenter"; break;
                        case SDLK_RETURN:
                        case SDLK_KP_ENTER: navigation = "enter"; break;
                        case SDLK_BACKSPACE: navigation = "backspace"; break;
                        case SDLK_F5:
                            if (event.key.mod & SDL_KMOD_CTRL) navigation = "restart";
                            break;
                        default: break;
                    }
                }
                if (navigation) {
                    runtime->dispatchSynchronouslyOnJsThread(STRING_LITERAL("world_home_navigate"),
                        [&](Valdi::JavaScriptEntryParameters& entry) {
                            auto* js = entry.jsContext.getJsiRuntime();
                            auto handler = js->global().getProperty(*js, "__worldNavigate");
                            if (handler.isObject())
                                handler.asObject(*js).asFunction(*js).call(*js,
                                    facebook::jsi::String::createFromUtf8(*js, navigation), amount);
                        });
                }
            }
            if (interactive && event.type == SDL_EVENT_TEXT_INPUT && !shellClient &&
                event.text.text[0] != '\0') {
                const std::string input(event.text.text);
                runtime->dispatchSynchronouslyOnJsThread(STRING_LITERAL("world_home_text_input"),
                    [&](Valdi::JavaScriptEntryParameters& entry) {
                        auto* js = entry.jsContext.getJsiRuntime();
                        auto handler = js->global().getProperty(*js, "__worldTextInput");
                        if (handler.isObject())
                            handler.asObject(*js).asFunction(*js).call(*js,
                                facebook::jsi::String::createFromUtf8(*js, input));
                    });
            }
            if (interactive && (event.type == SDL_EVENT_MOUSE_MOTION ||
                                event.type == SDL_EVENT_MOUSE_BUTTON_DOWN ||
                                (shellClient && event.type == SDL_EVENT_MOUSE_BUTTON_UP))) {
                int windowWidth = 0, windowHeight = 0, pixelWidth = 0, pixelHeight = 0;
                SDL_GetWindowSize(window, &windowWidth, &windowHeight);
                SDL_GetWindowSizeInPixels(window, &pixelWidth, &pixelHeight);
                if (windowWidth < 1 || windowHeight < 1 || pixelWidth < 1 || pixelHeight < 1)
                    continue;
                const double logicalX = event.type == SDL_EVENT_MOUSE_MOTION ?
                    event.motion.x : event.button.x;
                const double logicalY = event.type == SDL_EVENT_MOUSE_MOTION ?
                    event.motion.y : event.button.y;
                const double x = logicalX * pixelWidth / windowWidth;
                const double y = logicalY * pixelHeight / windowHeight;
                const bool clicked = event.type == SDL_EVENT_MOUSE_BUTTON_DOWN &&
                                     event.button.button == SDL_BUTTON_LEFT;
                const bool released = event.type == SDL_EVENT_MOUSE_BUTTON_UP &&
                                      event.button.button == SDL_BUTTON_LEFT;
                runtime->dispatchSynchronouslyOnJsThread(STRING_LITERAL("world_home_pointer"),
                    [&](Valdi::JavaScriptEntryParameters& entry) {
                        auto* js = entry.jsContext.getJsiRuntime();
                        auto handler = js->global().getProperty(*js, "__worldPointer");
                        if (handler.isObject())
                            handler.asObject(*js).asFunction(*js).call(*js, x, y, clicked, released);
                    });
            }
            if (!script.empty() && event.type == SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED) {
                int width = 0, height = 0;
                SDL_GetWindowSizeInPixels(window, &width, &height);
                if (width > 0 && height > 0) {
                    runtime->dispatchSynchronouslyOnJsThread(STRING_LITERAL("world_home_resize"),
                        [&](Valdi::JavaScriptEntryParameters& entry) {
                            auto* js = entry.jsContext.getJsiRuntime();
                            auto handler = js->global().getProperty(*js, "__worldResize");
                            if (handler.isObject())
                                handler.asObject(*js).asFunction(*js).call(*js, width, height);
                        });
                }
            }
        }
        if (quit) break;
        if (worldChannel) worldChannel->serviceWorldArrival();
        bool presented = false;
        bool quitRequested = false;
        {
            std::lock_guard<std::mutex> lock(result->mutex);
            complete = result->finished;
            presented = result->presented;
            quitRequested = result->quitRequested;
        }
        if (quitRequested || (complete && (!interactive || !presented))) break;
        SDL_Delay(16);
    }
    bool presented = false;
    std::string message;
    {
        std::lock_guard<std::mutex> lock(result->mutex);
        complete = result->finished;
        presented = result->presented;
        message = result->message;
    }
    if (!interactive && complete && presented) SDL_Delay(1500);

    runtime->dispatchSynchronouslyOnJsThread(STRING_LITERAL("dispose_webgpu_wayland_surface"),
                                             [&](Valdi::JavaScriptEntryParameters& entry) {
        auto* js = entry.jsContext.getJsiRuntime();
        auto stop = js->global().getProperty(*js, "__nativeStop");
        if (stop.isObject()) stop.asObject(*js).asFunction(*js).call(*js);
        auto& registry = rnwgpu::SurfaceRegistry::getInstance();
        if (auto info = registry.getSurfaceInfo(kContextId)) info->detachSurface();
        registry.removeSurfaceInfo(kContextId);
        webgpu.reset();
    });
    std::printf("Valdi WebGPU Wayland surface: %s (%s)\n",
                complete && presented ? "presented" : "failed", message.c_str());
    standalone = nullptr;
    SDL_DestroyWindow(window);
    SDL_Quit();
    return installed && complete && presented ? 0 : 1;
}
