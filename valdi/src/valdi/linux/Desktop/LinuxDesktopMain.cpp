#include "valdi/linux/Desktop/LinuxDesktopMain.hpp"
#include "valdi/linux/LinuxRuntime.hpp"
#include "valdi/linux/Desktop/LinuxDocumentStore.hpp"
#include "valdi/runtime/Runtime.hpp"
#include "valdi/runtime/Context/ViewManagerContext.hpp"
#include "valdi/runtime/RuntimeManager.hpp"
#include "valdi/runtime/JavaScript/JavaScriptRuntime.hpp"
#include "valdi/standalone_runtime/StandaloneMainQueue.hpp"
#include "valdi_core/cpp/Threading/IQueueListener.hpp"
#include "valdi/standalone_runtime/StandaloneResourceLoader.hpp"
#include "valdi/standalone_runtime/ValdiStandaloneRuntime.hpp"
#include "valdi/snap_drawing/Runtime.hpp"
#include "valdi/snap_drawing/Layers/ValdiLayer.hpp"
#include "snap_drawing/cpp/Drawing/GraphicsContext/BitmapGraphicsContext.hpp"
#include "snap_drawing/cpp/Drawing/IFrameScheduler.hpp"
#include "snap_drawing/cpp/Layers/LayerRoot.hpp"
#include "snap_drawing/cpp/Text/FontManager.hpp"
#include "snap_drawing/cpp/Touches/GesturesConfiguration.hpp"
#include "valdi_core/cpp/Utils/ConsoleLogger.hpp"
#include "valdi_core/cpp/Utils/StringCache.hpp"
#include "valdi_core/cpp/Utils/ValueFunctionWithCallable.hpp"
#include <SDL3/SDL.h>
#include <fontconfig/fontconfig.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <algorithm>
#include <cstring>
#include <fstream>
#include <iostream>
#include <mutex>
#include <set>
#include <vector>

namespace ValdiLinux {
namespace {

class QueueWakeup : public Valdi::IQueueListener {
public:
    explicit QueueWakeup(uint32_t eventType) : _eventType(eventType) {}
    void onQueueEmpty() override {}
    void onQueueNonEmpty() override {
        SDL_Event event {}; event.type = _eventType; SDL_PushEvent(&event);
    }
private:
    uint32_t _eventType;
};

void loadSystemFonts(snap::drawing::SnapDrawingViewManager& manager) {
    auto* config = FcInitLoadConfigAndFonts();
    if (config == nullptr) { return; }
    auto* pattern = FcPatternCreate();
    auto* objects = FcObjectSetBuild(FC_FILE, FC_FAMILY, FC_WEIGHT, FC_SLANT, nullptr);
    auto* fonts = FcFontList(config, pattern, objects);
    std::set<std::string> loaded;
    if (fonts != nullptr) {
        for (int i = 0; i < fonts->nfont; ++i) {
            FcChar8* filename = nullptr; FcChar8* family = nullptr;
            if (FcPatternGetString(fonts->fonts[i], FC_FILE, 0, &filename) != FcResultMatch ||
                FcPatternGetString(fonts->fonts[i], FC_FAMILY, 0, &family) != FcResultMatch ||
                !loaded.insert(reinterpret_cast<char*>(filename)).second) { continue; }
            std::ifstream input(reinterpret_cast<char*>(filename), std::ios::binary);
            auto bytes = Valdi::makeShared<Valdi::Bytes>();
            bytes->assign(std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>());
            if (bytes->empty()) { continue; }
            int weight = FC_WEIGHT_REGULAR, slant = FC_SLANT_ROMAN;
            FcPatternGetInteger(fonts->fonts[i], FC_WEIGHT, 0, &weight);
            FcPatternGetInteger(fonts->fonts[i], FC_SLANT, 0, &slant);
            const snap::drawing::FontStyle style(snap::drawing::FontWidthNormal,
                weight >= FC_WEIGHT_DEMIBOLD ? snap::drawing::FontWeightBold : snap::drawing::FontWeightNormal,
                slant == FC_SLANT_ROMAN ? snap::drawing::FontSlantUpright : snap::drawing::FontSlantItalic);
            manager.registerTypeface(Valdi::StringBox::fromCString(reinterpret_cast<char*>(family)), style,
                true, Valdi::BytesView(bytes));
        }
        FcFontSetDestroy(fonts);
    }
    FcObjectSetDestroy(objects); FcPatternDestroy(pattern); FcConfigDestroy(config);
}

Valdi::Value makeEvent(const char* type, const std::string& text, bool ctrl = false, bool shift = false) {
    Valdi::Value event;
    event.setMapValue("type", Valdi::Value(Valdi::StringBox::fromCString(type)));
    event.setMapValue("text", Valdi::Value(Valdi::StringBox::fromString(text)));
    event.setMapValue("ctrl", Valdi::Value(ctrl));
    event.setMapValue("shift", Valdi::Value(shift));
    return event;
}
}

int valdiLinuxDesktopMain(const char* componentPath, const char* title, int argc, const char** argv) {
    std::string stateDirectory, screenshot, fallbackFont;
    bool smoke = false, reopen = false;
    for (int i = 1; i < argc; ++i) {
        std::string arg(argv[i]);
        if ((arg == "--state-dir" || arg == "--screenshot") && i + 1 < argc) {
            (arg == "--state-dir" ? stateDirectory : screenshot) = argv[++i];
        } else if (arg == "--fallback-font" && i + 1 < argc) { fallbackFont = argv[++i]; }
        else if (arg == "--smoke-test") { smoke = true; }
        else if (arg == "--smoke-reopen") { reopen = true; }
        else { std::cerr << "Unknown argument: " << arg << '\n'; return 2; }
    }
    LinuxDocumentStore store(stateDirectory);
    if (!stateDirectory.empty() && !store.enabled()) {
        std::cerr << "State directory must be an owned private directory (mode 0700).\n"; return 2;
    }
    SDL_SetHint(SDL_HINT_VIDEO_X11_NET_WM_BYPASS_COMPOSITOR, "0");
    SDL_SetHint(SDL_HINT_VIDEO_WAYLAND_ALLOW_LIBDECOR, "0");
    if (!SDL_Init(SDL_INIT_VIDEO | SDL_INIT_EVENTS)) { std::cerr << SDL_GetError() << '\n'; return 1; }
    auto* window = SDL_CreateWindow(title, 900, 640, SDL_WINDOW_RESIZABLE | SDL_WINDOW_HIGH_PIXEL_DENSITY);
    if (window == nullptr) { std::cerr << SDL_GetError() << '\n'; SDL_Quit(); return 1; }
    std::cout << "VALDI_LINUX_BACKEND=" << SDL_GetCurrentVideoDriver() << std::endl;
    const auto wakeEvent = SDL_RegisterEvents(1);
    if (wakeEvent == 0) {
        std::cerr << SDL_GetError() << '\n'; SDL_DestroyWindow(window); SDL_Quit(); return 1;
    }

    auto runtime = createLinuxRuntime(false, true);
    runtime->getResourceLoader().addModuleSearchDirectory(Valdi::StringBox::fromCString("."));
    runtime->setupJsRuntime({});
    auto drawing = Valdi::makeShared<snap::drawing::Runtime>(nullptr,
        snap::drawing::GesturesConfiguration::getDefault(), nullptr, nullptr,
        Valdi::ConsoleLogger::getLogger(), runtime->getRuntimeManager().getWorkerQueue(), 32 * 1024 * 1024);
    drawing->initializeViewManager(Valdi::PlatformTypeLinux);
    loadSystemFonts(*drawing->getViewManager());
    if (!fallbackFont.empty()) {
        std::ifstream input(fallbackFont, std::ios::binary);
        auto bytes = Valdi::makeShared<Valdi::Bytes>();
        bytes->assign(std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>());
        if (bytes->empty() || bytes->size() > 32 * 1024 * 1024) {
            std::cerr << "Fallback font is unreadable or exceeds 32 MiB\n";
            runtime = nullptr; drawing = nullptr; SDL_DestroyWindow(window); SDL_Quit(); return 2;
        }
        drawing->getViewManager()->registerTypeface(Valdi::StringBox::fromCString("Linux fallback"),
            snap::drawing::FontStyle(snap::drawing::FontWidthNormal, snap::drawing::FontWeightNormal,
                snap::drawing::FontSlantUpright), true, Valdi::BytesView(bytes));
    }
    auto viewContext = runtime->getRuntimeManager().createViewManagerContext(*drawing->getViewManager(), false);
    runtime->getRuntime().getJavaScriptRuntime()->setDefaultViewManagerContext(viewContext);
    auto root = Valdi::makeShared<snap::drawing::LayerRoot>(drawing->getResources());
    auto component = snap::drawing::makeLayer<snap::drawing::ValdiLayer>(drawing->getResources(),
        &runtime->getRuntime(), viewContext.get());
    std::mutex bridgeMutex;
    Valdi::Ref<Valdi::ValueFunction> inputHandler;
    Valdi::Value inspection;
    auto* initialClipboard = SDL_GetClipboardText();
    std::string clipboard = initialClipboard != nullptr ? initialClipboard : "";
    SDL_free(initialClipboard);
    std::optional<std::string> clipboardWrite;
    Valdi::Value context;
    auto bind = [&](const char* name, Valdi::ValueFunctionCallable callback) {
        context.setMapValue(name, Valdi::Value(Valdi::makeShared<Valdi::ValueFunctionWithCallable>(std::move(callback))));
    };
    bind("subscribeInput", [&](const Valdi::ValueFunctionCallContext& call) {
        std::lock_guard<std::mutex> guard(bridgeMutex);
        inputHandler = call.getParameterAsFunction(0); return Valdi::Value();
    });
    bind("publishState", [&](const Valdi::ValueFunctionCallContext& call) {
        std::lock_guard<std::mutex> guard(bridgeMutex);
        inspection = call.getParameter(0); return Valdi::Value();
    });
    bind("readDocument", [&](const Valdi::ValueFunctionCallContext&) {
        return Valdi::Value(Valdi::StringBox::fromString(store.read()));
    });
    bind("saveDocument", [&](const Valdi::ValueFunctionCallContext& call) {
        auto text = call.getParameterAsString(0);
        if (!call.getExceptionTracker()) { return Valdi::Value(false); }
        return Valdi::Value(store.write(std::string(text.toStringView())));
    });
    // Scripts run on Valdi's JS thread. SDL video/clipboard work stays on the event thread.
    bind("readClipboard", [&](const Valdi::ValueFunctionCallContext&) {
        std::lock_guard<std::mutex> guard(bridgeMutex);
        return Valdi::Value(Valdi::StringBox::fromString(clipboard));
    });
    bind("writeClipboard", [&](const Valdi::ValueFunctionCallContext& call) {
        std::lock_guard<std::mutex> guard(bridgeMutex);
        auto text = call.getParameterAsString(0);
        if (!call.getExceptionTracker()) { return Valdi::Value(false); }
        clipboard = std::string(text.toStringView());
        clipboardWrite = clipboard;
        SDL_Event wake {}; wake.type = wakeEvent; SDL_PushEvent(&wake);
        return Valdi::Value(true); // Accepted; the event loop applies it below.
    });
    context.setMapValue("storageEnabled", Valdi::Value(store.enabled()));
    component->setComponent(Valdi::StringBox::fromCString(componentPath), Valdi::Value(), context);
    root->setContentLayer(component, snap::drawing::ContentLayerSizingModeMatchSize);
    SDL_StartTextInput(window);
    snap::drawing::BitmapGraphicsContext graphics;
    auto queue = runtime->getMainQueue();
    queue->setListener(std::make_shared<QueueWakeup>(wakeEvent));
    bool running = true, forceDraw = true;
    int result = (smoke || reopen) ? 1 : 0, smokeStage = 0;
    uint64_t start = SDL_GetTicks(), lastDraw = 0;
    const std::string expected = "Hello Linux! مرحبا — 日本語";
    auto send = [&](const Valdi::Value& event) {
        Valdi::Ref<Valdi::ValueFunction> handler;
        { std::lock_guard<std::mutex> guard(bridgeMutex); handler = inputHandler; }
        if (handler != nullptr) { (*handler)(Valdi::ValueFunctionFlagsNeverCallSync, &event, 1); }
    };
    auto pushKey = [&](SDL_Keycode key, bool ctrl = false) {
        SDL_Event event {}; event.type = SDL_EVENT_KEY_DOWN; event.key.down = true;
        event.key.windowID = SDL_GetWindowID(window); event.key.timestamp = SDL_GetTicksNS();
        event.key.key = key; event.key.mod = ctrl ? SDL_KMOD_CTRL : SDL_KMOD_NONE;
        SDL_PushEvent(&event);
    };
    auto pushText = [&](const std::string& text) {
        SDL_Event event {}; event.type = SDL_EVENT_TEXT_INPUT;
        event.text.windowID = SDL_GetWindowID(window); event.text.timestamp = SDL_GetTicksNS();
        // SDL copies the event; expected's string remains alive until the probe exits.
        event.text.text = text.c_str();
        SDL_PushEvent(&event);
    };
    auto refreshClipboard = [&]() {
        std::lock_guard<std::mutex> guard(bridgeMutex);
        // Keep a just-accepted JS copy available even before SDL has applied it.
        if (!clipboardWrite) {
            auto* text = SDL_GetClipboardText();
            clipboard = text != nullptr ? text : "";
            SDL_free(text);
        }
    };
    std::vector<uint8_t> pixels;
    while (running && !queue->isDisposed()) {
        // Drain only work already due; do not block Valdi's dispatcher behind SDL's event queue.
        queue->flushUpToNow();
        SDL_Event event;
        if (SDL_WaitEventTimeout(&event, forceDraw ? 0 : root->needsProcessFrame() ? 8 : (smoke || reopen) ? 16 : 500)) {
            do {
                switch (event.type) {
                    case SDL_EVENT_QUIT: running = false; break;
                    case SDL_EVENT_WINDOW_CLOSE_REQUESTED: running = false; break;
                    case SDL_EVENT_WINDOW_RESIZED:
                    case SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED:
                    case SDL_EVENT_WINDOW_EXPOSED: forceDraw = true; break;
                    case SDL_EVENT_MOUSE_BUTTON_DOWN:
                    case SDL_EVENT_MOUSE_BUTTON_UP:
                    case SDL_EVENT_MOUSE_MOTION:
                    case SDL_EVENT_MOUSE_WHEEL: {
                        float x, y; SDL_GetMouseState(&x, &y);
                        auto point = snap::drawing::Point::make(x, y);
                        auto type = event.type == SDL_EVENT_MOUSE_BUTTON_DOWN ? snap::drawing::TouchEventTypeDown :
                            event.type == SDL_EVENT_MOUSE_BUTTON_UP ? snap::drawing::TouchEventTypeUp :
                            event.type == SDL_EVENT_MOUSE_WHEEL ? snap::drawing::TouchEventTypeWheel : snap::drawing::TouchEventTypeMoved;
                        auto direction = snap::drawing::Vector::make(event.type == SDL_EVENT_MOUSE_WHEEL ? -event.wheel.x * 32 : 0,
                            event.type == SDL_EVENT_MOUSE_WHEEL ? -event.wheel.y * 32 : 0);
                        root->dispatchTouchEvent(snap::drawing::TouchEvent(type, point, point, direction, 1, 0,
                            {}, snap::drawing::TimePoint::now(), snap::drawing::Duration(), nullptr));
                        break;
                    }
                    case SDL_EVENT_TEXT_INPUT: send(makeEvent("text", event.text.text)); break;
                    case SDL_EVENT_TEXT_EDITING: send(makeEvent("composition", event.edit.text)); break;
                    case SDL_EVENT_CLIPBOARD_UPDATE: {
                        refreshClipboard(); break;
                    }
                    case SDL_EVENT_KEY_DOWN:
                        if ((event.key.mod & SDL_KMOD_CTRL) && event.key.key == SDLK_V) {
                            refreshClipboard();
                        }
                        send(makeEvent("key", SDL_GetKeyName(event.key.key),
                            (event.key.mod & SDL_KMOD_CTRL) != 0, (event.key.mod & SDL_KMOD_SHIFT) != 0));
                        break;
                    default: break;
                }
            } while (SDL_PollEvent(&event));
        }
        queue->flushUpToNow();
        {
            std::lock_guard<std::mutex> guard(bridgeMutex);
            if (clipboardWrite) {
                if (!SDL_SetClipboardText(clipboardWrite->c_str())) {
                    std::cerr << "Clipboard write failed: " << SDL_GetError() << '\n';
                }
                clipboardWrite.reset();
            }
        }
        auto now = SDL_GetTicks();
        if ((smoke || reopen) && now - start > static_cast<uint64_t>(500 + smokeStage * 180)) {
            if (reopen) { smokeStage = 6; }
            else {
                switch (smokeStage) {
                    case 0: pushKey(SDLK_A, true); break;
                    case 1: pushText(expected); break;
                    case 2: pushKey(SDLK_S, true); break;
                    case 3: pushKey(SDLK_BACKSPACE); break;
                    case 4: pushKey(SDLK_Z, true); break;
                    case 5: SDL_SetWindowSize(window, 820, 560); forceDraw = true; break;
                    default: break;
                }
                ++smokeStage;
            }
            if (smokeStage > 6 || reopen) {
                Valdi::Value snapshot;
                { std::lock_guard<std::mutex> guard(bridgeMutex); snapshot = inspection; }
                bool ok = snapshot.getMapValue("text").toStringBox().toStringView() == expected && store.read() == expected;
                std::cout << (ok ? "VALDI_LINUX_SMOKE_PASS" : "VALDI_LINUX_SMOKE_FAIL") << '\n';
                result = ok ? 0 : 1; running = false; forceDraw = true;
            }
        }
        int logicalWidth, logicalHeight; SDL_GetWindowSize(window, &logicalWidth, &logicalHeight);
        auto* surface = SDL_GetWindowSurface(window);
        if (surface == nullptr) {
            std::cerr << "Window surface unavailable: " << SDL_GetError() << '\n'; result = 1; break;
        }
        if (logicalWidth <= 0 || logicalHeight <= 0) { continue; }
        root->setSize(snap::drawing::Size::make(logicalWidth, logicalHeight),
            static_cast<float>(surface->w) / logicalWidth);
        bool dirty = root->needsProcessFrame() || forceDraw;
        if (dirty && (now - lastDraw >= 8 || !running)) {
            root->processFrame(snap::drawing::TimePoint::now());
            pixels.resize(static_cast<size_t>(surface->w) * surface->h * 4);
            auto drawable = graphics.createBitmapSurface(Valdi::BitmapInfo(surface->w, surface->h,
                Valdi::ColorTypeRGBA8888, Valdi::AlphaTypePremul, static_cast<size_t>(surface->w) * 4), pixels.data());
            auto canvas = drawable->prepareCanvas();
            if (!canvas) { std::cerr << "Could not create raster canvas\n"; result = 1; break; }
            root->drawInCanvas(canvas.value());
            if (SDL_MUSTLOCK(surface) && !SDL_LockSurface(surface)) {
                std::cerr << SDL_GetError() << '\n'; result = 1; break;
            }
            bool converted = SDL_ConvertPixels(surface->w, surface->h, SDL_PIXELFORMAT_RGBA32,
                pixels.data(), surface->w * 4, surface->format, surface->pixels, surface->pitch);
            if (SDL_MUSTLOCK(surface)) { SDL_UnlockSurface(surface); }
            if (!converted) { std::cerr << SDL_GetError() << '\n'; result = 1; break; }
            if (!SDL_UpdateWindowSurface(window)) { std::cerr << SDL_GetError() << '\n'; result = 1; break; }
            if (!running && !screenshot.empty()) {
                auto image = canvas.value().snapshot();
                if (image) {
                    auto png = image.value()->toPNG();
                    if (png) {
                        std::ofstream output(screenshot, std::ios::binary);
                        output.write(reinterpret_cast<const char*>(png.value().data()), png.value().size());
                        if (!output) { result = 1; }
                    } else { result = 1; }
                } else { result = 1; }
            }
            drawable->flush(); forceDraw = false; lastDraw = now;
        }
        if ((smoke || reopen) && now - start > 15000) { result = 1; break; }
    }
    queue->setListener(nullptr);
    { std::lock_guard<std::mutex> guard(bridgeMutex); inputHandler = nullptr; }
    root->destroy(); component = nullptr; root = nullptr; viewContext = nullptr;
    runtime = nullptr; drawing = nullptr;
    SDL_StopTextInput(window); SDL_DestroyWindow(window); SDL_Quit();
    return result;
}
}
