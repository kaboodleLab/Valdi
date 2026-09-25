#include "RNWebGPUManager.h"
#include "SurfaceRegistry.h"
#include "valdi/linux/LinuxRuntime.hpp"
#include "valdi/runtime/JavaScript/JavaScriptRuntime.hpp"
#include "valdi/runtime/Runtime.hpp"
#include "valdi_core/cpp/Utils/StringCache.hpp"

#include <SDL3/SDL.h>
#include <jsi/jsi.h>
#include <webgpu/webgpu.h>

#include <algorithm>
#include <chrono>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <memory>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

constexpr int kContextId = 7;
constexpr int kWidth = 720;
constexpr int kHeight = 720;

struct ProbeResult {
    std::mutex mutex;
    bool finished = false;
    bool presented = false;
    std::string message;
};

class FileBuffer final : public facebook::jsi::MutableBuffer {
public:
    explicit FileBuffer(const std::string& path) {
        std::ifstream file(path, std::ios::binary | std::ios::ate);
        if (!file) throw std::runtime_error("Cannot open native asset: " + path);
        const auto length = file.tellg();
        if (length < 0 || length > 32 * 1024 * 1024)
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
    int frameLimit = 1;
    for (int i = 1; i < argc; ++i) {
        const std::string arg(argv[i]);
        if (arg == "--interactive") {
            interactive = true;
            frameLimit = 0;
        } else if (arg.rfind("--frames=", 0) == 0) {
            frameLimit = std::atoi(arg.c_str() + 9);
            if (frameLimit < 1 || frameLimit > 100000) {
                std::fprintf(stderr, "--frames must be between 1 and 100000\n");
                return 2;
            }
        } else if (scriptPath.empty()) {
            scriptPath = arg;
        } else {
            std::fprintf(stderr, "Usage: %s [--frames=N|--interactive] [bundled-javascript.js]\n", argv[0]);
            return 2;
        }
    }
    if (interactive) frameLimit = 0;
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
    if (!SDL_Init(SDL_INIT_VIDEO)) {
        std::fprintf(stderr, "SDL_Init: %s\n", SDL_GetError());
        return 1;
    }
    SDL_Window* window = SDL_CreateWindow("WorldOS Valdi Hermes WebGPU", kWidth, kHeight,
                                          SDL_WINDOW_VULKAN);
    if (window == nullptr) {
        std::fprintf(stderr, "SDL_CreateWindow: %s\n", SDL_GetError());
        SDL_Quit();
        return 1;
    }
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
            [result](facebook::jsi::Runtime& js,
                     const facebook::jsi::Value&,
                     const facebook::jsi::Value* args,
                     size_t count) -> facebook::jsi::Value {
                std::lock_guard<std::mutex> lock(result->mutex);
                result->presented = count > 0 && args[0].isBool() && args[0].getBool();
                if (count > 1 && args[1].isString()) result->message = args[1].getString(js).utf8(js);
                result->finished = true;
                return facebook::jsi::Value::undefined();
            });
        jsi->global().setProperty(*jsi, "__webgpuSurfaceDone", std::move(done));
        if (!script.empty()) {
            jsi->global().setProperty(*jsi, "__nativeFrameLimit", frameLimit);
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
                (event.type == SDL_EVENT_KEY_DOWN && event.key.key == SDLK_ESCAPE)) {
                quit = true;
                break;
            }
            if (interactive && (event.type == SDL_EVENT_MOUSE_MOTION ||
                                event.type == SDL_EVENT_MOUSE_BUTTON_DOWN)) {
                const double x = event.type == SDL_EVENT_MOUSE_MOTION ? event.motion.x : event.button.x;
                const double y = event.type == SDL_EVENT_MOUSE_MOTION ? event.motion.y : event.button.y;
                const bool clicked = event.type == SDL_EVENT_MOUSE_BUTTON_DOWN;
                runtime->dispatchSynchronouslyOnJsThread(STRING_LITERAL("world_home_pointer"),
                    [&](Valdi::JavaScriptEntryParameters& entry) {
                        auto* js = entry.jsContext.getJsiRuntime();
                        auto handler = js->global().getProperty(*js, "__worldPointer");
                        if (handler.isObject())
                            handler.asObject(*js).asFunction(*js).call(*js, x, y, clicked);
                    });
            }
        }
        if (quit) break;
        {
            std::lock_guard<std::mutex> lock(result->mutex);
            complete = result->finished;
        }
        if (complete && (!interactive || !result->presented)) break;
        SDL_Delay(16);
    }
    if (!interactive && complete && result->presented) SDL_Delay(1500);

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
                complete && result->presented ? "presented" : "failed", result->message.c_str());
    standalone = nullptr;
    SDL_DestroyWindow(window);
    SDL_Quit();
    return installed && complete && result->presented ? 0 : 1;
}
