#include "valdi/linux/Desktop/LinuxDesktopMain.hpp"
#include "valdi/linux/LinuxRuntime.hpp"
#include "valdi/linux/Desktop/LinuxDocumentStore.hpp"
#include "valdi/linux/Desktop/LinuxRichContent.hpp"
#include "valdi_core/cpp/Utils/ValueUtils.hpp"
#include "valdi_core/cpp/Utils/ValueArray.hpp"
#include "valdi_core/cpp/Utils/JSONWriter.hpp"
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
#include "snap_drawing/cpp/Layers/TextLayer.hpp"
#include "include/core/SkCanvas.h"
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

snap::drawing::Layer* findLayer(snap::drawing::Layer* root, const char* id) {
    std::vector<snap::drawing::Layer*> pending {root};
    size_t visited = 0;
    while (!pending.empty() && ++visited <= 8192) {
        auto* layer = pending.back(); pending.pop_back();
        if (layer->getAccessibilityId().toStringView() == id) { return layer; }
        for (size_t i = 0; i < layer->getChildrenSize(); ++i) { pending.push_back(layer->getChild(i).get()); }
    }
    return nullptr;
}

snap::drawing::Rect clipped(snap::drawing::Rect rect, snap::drawing::Rect clip) {
    auto x = std::clamp(rect.x(), clip.x(), clip.x() + clip.width());
    auto y = std::clamp(rect.y(), clip.y(), clip.y() + clip.height());
    return snap::drawing::Rect::makeXYWH(x, y,
        std::max(0.0f, std::min(rect.x() + rect.width(), clip.x() + clip.width()) - x),
        std::max(0.0f, std::min(rect.y() + rect.height(), clip.y() + clip.height()) - y));
}
Valdi::Value rectValue(const snap::drawing::Rect& rect) {
    return Valdi::Value(Valdi::ValueArray::make({Valdi::Value(rect.x()), Valdi::Value(rect.y()), Valdi::Value(rect.width()), Valdi::Value(rect.height())}));
}
Valdi::Value contentValue(snap::drawing::Layer* root, const char* title, int width, int height,
                        const Valdi::Value& description, bool focused,
                        const std::optional<snap::drawing::Rect>& caret) {
    auto nodesValue = description.getMapValue("nodes");
    auto* nodes = nodesValue.getArray();
    if (!nodes || nodes->size() > 255) { return {}; }
    auto extent = snap::drawing::Rect::makeXYWH(0, 0, width, height);
    auto resultNodes = Valdi::ValueArray::make(nodes->size() + 1);
    Valdi::Value base;
    base.setMapValue("key", Valdi::Value(Valdi::StringBox::fromCString("root")));
    base.setMapValue("parent", Valdi::Value());
    base.setMapValue("role", Valdi::Value(Valdi::StringBox::fromCString("group")));
    base.setMapValue("label", Valdi::Value(Valdi::StringBox::fromCString(title)));
    base.setMapValue("bounds", rectValue(extent));
    base.setMapValue("text", Valdi::Value());
    resultNodes->emplace(0, base);
    size_t index = 1;
    for (const auto& source : *nodes) {
        auto layerName = source.getMapValue("layer").toStringBox();
        auto* layer = findLayer(root, layerName.getCStr());
        if (!layer) { return {}; } // Wait for the complete matching Valdi render tree.
        auto bounds = clipped(layer->getAbsoluteVisualFrame(), extent);
        auto clipValue = source.getMapValue("clipLayer");
        if (clipValue.isString()) {
            auto clipName = clipValue.toStringBox();
            auto* clipLayer = findLayer(root, clipName.getCStr());
            if (!clipLayer) { return {}; }
            bounds = clipped(bounds, clipped(clipLayer->getAbsoluteVisualFrame(), extent));
        }
        Valdi::Value node;
        for (const char* key : {"key", "parent", "role", "label", "disabled"}) { node.setMapValue(key, source.getMapValue(key)); }
        node.setMapValue("disabled", Valdi::Value(source.getMapValue("disabled").toBool()));
        node.setMapValue("focused", Valdi::Value(focused && source.getMapValue("focused").toBool()));
        node.setMapValue("bounds", rectValue(bounds));
        auto text = source.getMapValue("text");
        if (text.isMap()) {
            Valdi::Value mapped;
            for (const char* key : {"length", "anchor", "cursor"}) { mapped.setMapValue(key, Valdi::Value(text.getMapValue(key).toInt())); }
            mapped.setMapValue("preview", text.getMapValue("preview"));
            mapped.setMapValue("caret", caret && source.getMapValue("role").toStringBox().toStringView() == "text-input" ?
                rectValue(clipped(*caret, extent)) : Valdi::Value());
            node.setMapValue("text", mapped);
        } else { node.setMapValue("text", Valdi::Value()); }
        resultNodes->emplace(index++, node);
    }
    Valdi::Value packet;
    packet.setMapValue("schema", Valdi::Value(Valdi::StringBox::fromCString("spaos.content.experimental/1")));
    packet.setMapValue("textEngine", Valdi::Value(Valdi::StringBox::fromCString("snapdrawing/harfbuzz")));
    packet.setMapValue("extent", Valdi::Value(Valdi::ValueArray::make({Valdi::Value(width), Valdi::Value(height)})));
    packet.setMapValue("nodes", Valdi::Value(resultNodes));
    return packet;
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
    std::string stateDirectory, screenshot, fallbackFont, contentSnapshot, lastContentJSON;
    bool smoke = false, reopen = false, probeContent = false;
    Valdi::Value lastContentValue;
    for (int i = 1; i < argc; ++i) {
        std::string arg(argv[i]);
        if ((arg == "--state-dir" || arg == "--screenshot" || arg == "--content-snapshot") && i + 1 < argc) {
            (arg == "--state-dir" ? stateDirectory : arg == "--screenshot" ? screenshot : contentSnapshot) = argv[++i];
        } else if (arg == "--fallback-font" && i + 1 < argc) { fallbackFont = argv[++i]; }
        else if (arg == "--smoke-test") { smoke = true; }
        else if (arg == "--smoke-reopen") { reopen = true; }
        else if (arg == "--probe-content") { probeContent = true; }
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
    Valdi::Value inspection, presentation;
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
    bind("publishContent", [&](const Valdi::ValueFunctionCallContext& call) {
        // Resolve generated proxy values on the JS callback thread. The event thread receives
        // only an owned plain-data snapshot and never asks the JS runtime for properties.
        auto encoded = Valdi::valueToJsonString(call.getParameter(0));
        if (encoded.size() > 61440) { return Valdi::Value(false); }
        auto decoded = Valdi::correctJsonToValue(encoded);
        if (!decoded) { return Valdi::Value(false); }
        { std::lock_guard<std::mutex> guard(bridgeMutex); presentation = decoded.value(); }
        SDL_Event wake {}; wake.type = wakeEvent; SDL_PushEvent(&wake);
        return Valdi::Value(true);
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
    auto* arrowCursor = SDL_CreateSystemCursor(SDL_SYSTEM_CURSOR_DEFAULT);
    auto* textCursor = SDL_CreateSystemCursor(SDL_SYSTEM_CURSOR_TEXT);
    bool focused = true, caretVisible = true, selecting = false;
    uint64_t caretEpoch = SDL_GetTicks();
    snap::drawing::BitmapGraphicsContext graphics;
    auto queue = runtime->getMainQueue();
    queue->setListener(std::make_shared<QueueWakeup>(wakeEvent));
    auto richContent = std::make_unique<LinuxRichContent>(window);
    bool running = true, forceDraw = true;
    int result = (smoke || reopen || probeContent) ? 1 : 0, smokeStage = 0;
    uint32_t probeRevision = 0, probeRejected = 0;
    bool probeSent = false;
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
        richContent->pump();
        SDL_Event event;
        if (SDL_WaitEventTimeout(&event, forceDraw ? 0 : root->needsProcessFrame() ? 8 : (smoke || reopen) ? 16 : focused ? 100 : 500)) {
            do {
                switch (event.type) {
                    case SDL_EVENT_QUIT: running = false; break;
                    case SDL_EVENT_WINDOW_CLOSE_REQUESTED: running = false; break;
                    case SDL_EVENT_WINDOW_FOCUS_GAINED: focused = true; caretEpoch = SDL_GetTicks(); forceDraw = true; break;
                    case SDL_EVENT_WINDOW_FOCUS_LOST: focused = false; selecting = false; forceDraw = true; break;
                    case SDL_EVENT_WINDOW_RESIZED:
                    case SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED:
                    case SDL_EVENT_WINDOW_EXPOSED: forceDraw = true; break;
                    case SDL_EVENT_MOUSE_BUTTON_DOWN:
                    case SDL_EVENT_MOUSE_BUTTON_UP:
                    case SDL_EVENT_MOUSE_MOTION:
                    case SDL_EVENT_MOUSE_WHEEL: {
                        float x, y;
                        if (event.type == SDL_EVENT_MOUSE_MOTION) { x = event.motion.x; y = event.motion.y; }
                        else if (event.type == SDL_EVENT_MOUSE_BUTTON_DOWN || event.type == SDL_EVENT_MOUSE_BUTTON_UP) {
                            x = event.button.x; y = event.button.y;
                        } else { SDL_GetMouseState(&x, &y); }
                        auto point = snap::drawing::Point::make(x, y);
                        auto* editor = findLayer(component.get(), "note-editor");
                        SDL_SetCursor(editor && editor->getAbsoluteVisualFrame().contains(point) ? textCursor : arrowCursor);
                        auto* text = dynamic_cast<snap::drawing::TextLayer*>(findLayer(component.get(), "note-text"));
                        bool wasSelecting = selecting;
                        bool down = event.type == SDL_EVENT_MOUSE_BUTTON_DOWN && event.button.button == SDL_BUTTON_LEFT;
                        if (text && editor && ((down && editor->getAbsoluteVisualFrame().contains(point)) ||
                            (selecting && event.type == SDL_EVENT_MOUSE_MOTION))) {
                            auto frame = text->getAbsoluteVisualFrame();
                            auto offset = text->closestCaretUTF16(snap::drawing::Point::make(x - frame.x(), y - frame.y()));
                            auto input = makeEvent("pointer", "", false, selecting || (SDL_GetModState() & SDL_KMOD_SHIFT));
                            input.setMapValue("index", Valdi::Value(static_cast<int32_t>(offset)));
                            send(input); selecting = true; caretEpoch = SDL_GetTicks();
                        }
                        if (event.type == SDL_EVENT_MOUSE_BUTTON_UP && event.button.button == SDL_BUTTON_LEFT) { selecting = false; }
                        auto type = event.type == SDL_EVENT_MOUSE_BUTTON_DOWN ? snap::drawing::TouchEventTypeDown :
                            event.type == SDL_EVENT_MOUSE_BUTTON_UP ? snap::drawing::TouchEventTypeUp :
                            event.type == SDL_EVENT_MOUSE_WHEEL ? snap::drawing::TouchEventTypeWheel : snap::drawing::TouchEventTypeMoved;
                        auto direction = snap::drawing::Vector::make(event.type == SDL_EVENT_MOUSE_WHEEL ? -event.wheel.x * 32 : 0,
                            event.type == SDL_EVENT_MOUSE_WHEEL ? -event.wheel.y * 32 : 0);
                        if (event.type != SDL_EVENT_MOUSE_WHEEL && (selecting || wasSelecting)) { break; }
                        root->dispatchTouchEvent(snap::drawing::TouchEvent(type, point, point, direction, 1, 0,
                            {}, snap::drawing::TimePoint::now(), snap::drawing::Duration(), nullptr));
                        break;
                    }
                    case SDL_EVENT_TEXT_INPUT: caretEpoch = SDL_GetTicks(); send(makeEvent("text", event.text.text)); break;
                    case SDL_EVENT_TEXT_EDITING: send(makeEvent("composition", event.edit.text)); break;
                    case SDL_EVENT_CLIPBOARD_UPDATE: {
                        refreshClipboard(); break;
                    }
                    case SDL_EVENT_KEY_DOWN:
                        caretEpoch = SDL_GetTicks();
                        if ((event.key.mod & SDL_KMOD_CTRL) && event.key.key == SDLK_V) {
                            refreshClipboard();
                        }
                        send(makeEvent("key", SDL_GetKeyName(event.key.key),
                            (event.key.mod & SDL_KMOD_CTRL) != 0, (event.key.mod & SDL_KMOD_SHIFT) != 0));
                        break;
                    default: if (event.type == wakeEvent) { forceDraw = true; } break;
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
        if (probeContent && !probeSent && now - start > 3000 && richContent->acceptedRevision() > 0 && !lastContentJSON.empty()) {
            probeRevision = richContent->acceptedRevision(); probeRejected = richContent->rejectedCount();
            auto invalid = Valdi::correctJsonToValue(lastContentJSON);
            if (invalid) {
                invalid.value().setMapValue("schema", Valdi::Value(Valdi::StringBox::fromCString("spaos.content.experimental/99")));
                richContent->publish(Valdi::valueToJsonString(invalid.value())); probeSent = true;
            }
        }
        if (probeContent && probeSent && richContent->rejectedCount() > probeRejected) {
            bool retained = richContent->acceptedRevision() == probeRevision;
            std::cout << (retained ? "VALDI_CONTENT_REJECTION_PASS" : "VALDI_CONTENT_REJECTION_FAIL") << std::endl;
            result = retained ? 0 : 1; running = false; forceDraw = true;
        }
        if (probeContent && now - start > 15000) { result = 1; running = false; }
        bool blink = focused && ((now - caretEpoch) % 1000 < 500);
        if (blink != caretVisible) { caretVisible = blink; forceDraw = true; }
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
            {
                SkAutoCanvasRestore restore(canvas.value().getSkiaCanvas(), true);
                root->drawInCanvas(canvas.value());
            }
            std::optional<snap::drawing::Rect> caretGeometry;
            Valdi::Value caretState, description;
            { std::lock_guard<std::mutex> guard(bridgeMutex); caretState = inspection; description = presentation; }
            auto* textLayer = dynamic_cast<snap::drawing::TextLayer*>(findLayer(component.get(), "note-text"));
            auto* editor = findLayer(component.get(), "note-editor");
            auto cursor = caretState.getMapValue("cursor").toInt();
            if (textLayer && editor && cursor >= 0 && cursor == caretState.getMapValue("anchor").toInt()) {
                auto caret = textLayer->caretAtUTF16(static_cast<size_t>(cursor));
                if (caret) {
                    auto origin = textLayer->getAbsoluteVisualFrame();
                    auto clip = editor->getAbsoluteVisualFrame();
                    auto scale = static_cast<float>(surface->w) / logicalWidth;
                    auto x = origin.x() + caret->x(), y = origin.y() + caret->y();
                    if (focused || smoke || reopen) { caretGeometry = clipped(snap::drawing::Rect::makeXYWH(x, y, 1, caret->height()), clip); }
                    SDL_Rect inputArea {static_cast<int>(x), static_cast<int>(y), 1, static_cast<int>(caret->height())};
                    SDL_SetTextInputArea(window, &inputArea, 0);
                    if (caretVisible || smoke || reopen) {
                        auto* sk = canvas.value().getSkiaCanvas();
                        sk->save();
                        sk->clipRect(SkRect::MakeXYWH(clip.x()*scale, clip.y()*scale, clip.width()*scale, clip.height()*scale));
                        SkPaint paint; paint.setColor(0xff8ac3e5);
                        sk->drawRect(SkRect::MakeXYWH(roundf(x*scale), roundf(y*scale), 2, roundf(caret->height()*scale)), paint);
                        sk->restore();
                    }
                }
            }
            auto packetValue = contentValue(component.get(), title, logicalWidth, logicalHeight, description, focused, caretGeometry);
            if (packetValue.isMap() && packetValue != lastContentValue) {
                lastContentValue = packetValue;
                auto packet = Valdi::valueToJsonString(packetValue);
                richContent->publish(packet); lastContentJSON = packet;
                if (!contentSnapshot.empty()) {
                    std::ofstream output(contentSnapshot, std::ios::binary); output << packet;
                    if (!output) { std::cerr << "Could not write content snapshot\n"; result = 1; }
                }
            }
            richContent->pump();
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
    richContent = nullptr;
    queue->setListener(nullptr);
    { std::lock_guard<std::mutex> guard(bridgeMutex); inputHandler = nullptr; }
    root->destroy(); component = nullptr; root = nullptr; viewContext = nullptr;
    runtime = nullptr; drawing = nullptr;
    SDL_DestroyCursor(textCursor); SDL_DestroyCursor(arrowCursor);
    SDL_StopTextInput(window); SDL_DestroyWindow(window); SDL_Quit();
    return result;
}
}
