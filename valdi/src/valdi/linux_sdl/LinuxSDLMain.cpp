#include "valdi/linux_sdl/LinuxSDLMain.hpp"

#define SDL_MAIN_HANDLED
#include <SDL2/SDL.h>

#include "valdi/linux/LinuxRuntime.hpp"
#include "valdi/standalone_runtime/StandaloneMainQueue.hpp"
#include "valdi/standalone_runtime/StandaloneView.hpp"
#include "valdi_core/cpp/Utils/StringCache.hpp"
#include "valdi_core/cpp/Utils/ValueTypedArray.hpp"
#include "valdi_core/cpp/Views/Frame.hpp"

#include <chrono>
#include <cstdio>
#include <cstdlib>

namespace ValdiLinux {

static void traceView(const Valdi::Ref<Valdi::StandaloneView>& view, int depth) {
    const auto& frame = view->getFrame();
    const auto className = view->getViewClassName().toStringView();
    std::printf("%*s%.*s frame=(%.1f, %.1f, %.1f, %.1f)", depth * 2, "",
                static_cast<int>(className.size()), className.data(), frame.x, frame.y, frame.width, frame.height);
    const auto& meshBytes = view->getAttribute(STRING_LITERAL("meshBytes"));
    if (const auto* typedArray = meshBytes.getTypedArray()) {
        std::printf(" meshBytes=%zu", typedArray->getBuffer().size());
    }
    std::printf("\n");
    for (const auto& child : view->getChildren()) {
        traceView(child, depth + 1);
    }
}

int valdiLinuxSDLMain(const char* rootComponentPath, int width, int height, int argc, const char** argv) {
    SDL_SetMainReady();
    if (SDL_Init(SDL_INIT_VIDEO) != 0) {
        std::fprintf(stderr, "SDL_Init: %s\n", SDL_GetError());
        return 1;
    }

    SDL_Window* window = SDL_CreateWindow("Valdi Linux component host",
                                          SDL_WINDOWPOS_CENTERED,
                                          SDL_WINDOWPOS_CENTERED,
                                          width,
                                          height,
                                          SDL_WINDOW_RESIZABLE | SDL_WINDOW_ALLOW_HIGHDPI);
    if (window == nullptr) {
        std::fprintf(stderr, "SDL_CreateWindow: %s\n", SDL_GetError());
        SDL_Quit();
        return 1;
    }

    SDL_Renderer* renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_ACCELERATED);
    if (renderer == nullptr) {
        renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_SOFTWARE);
    }
    if (renderer == nullptr) {
        std::fprintf(stderr, "SDL_CreateRenderer: %s\n", SDL_GetError());
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    auto component = createLinuxComponentRuntime(rootComponentPath, width, height, argc, argv);
    auto mainQueue = component.runtime->getMainQueue();
    std::printf("Mounted Valdi component %s in an SDL %s window (%dx%d)\n",
                rootComponentPath, SDL_GetCurrentVideoDriver(), width, height);
    std::fflush(stdout);
    const bool traceViews = std::getenv("VALDI_LINUX_TRACE_VIEWS") != nullptr;
    const auto traceAt = std::chrono::steady_clock::now() + std::chrono::seconds(4);
    bool tracedViews = false;

    while (!mainQueue->isDisposed()) {
        SDL_Event event;
        while (SDL_PollEvent(&event)) {
            if (event.type == SDL_QUIT ||
                (event.type == SDL_WINDOWEVENT && event.window.event == SDL_WINDOWEVENT_CLOSE) ||
                (event.type == SDL_KEYDOWN && event.key.keysym.sym == SDLK_ESCAPE)) {
                mainQueue->exit(0);
            } else if (event.type == SDL_WINDOWEVENT &&
                       (event.window.event == SDL_WINDOWEVENT_SIZE_CHANGED ||
                        event.window.event == SDL_WINDOWEVENT_RESIZED) &&
                       event.window.data1 > 0 && event.window.data2 > 0) {
                component.rootViewTree->setLayoutSpecs(
                    Valdi::Size(event.window.data1, event.window.data2), Valdi::LayoutDirectionLTR);
            }
        }
        if (mainQueue->isDisposed()) break;

        mainQueue->runNextTask(std::chrono::steady_clock::now() + std::chrono::milliseconds(16));

        if (traceViews && !tracedViews && std::chrono::steady_clock::now() >= traceAt) {
            auto rootView = Valdi::StandaloneView::unwrap(component.rootViewTree->getRootView());
            if (rootView != nullptr) {
                std::printf("Valdi view tree:\n");
                traceView(rootView, 0);
                std::fflush(stdout);
            }
            tracedViews = true;
        }

        // This canvas marks the window/lifecycle boundary. Rendering the Valdi
        // view tree and Dawn surface into it is the next platform-host step.
        SDL_SetRenderDrawColor(renderer, 16, 24, 39, 255);
        SDL_RenderClear(renderer);
        SDL_RenderPresent(renderer);
    }

    const int exitCode = mainQueue->runIndefinitely();
    component.rootViewTree = nullptr;
    component.runtime = nullptr;
    SDL_DestroyRenderer(renderer);
    SDL_DestroyWindow(window);
    SDL_Quit();
    return exitCode;
}

} // namespace ValdiLinux
