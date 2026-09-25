#include <SDL.h>
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <vector>
#include <unistd.h>

constexpr int kSourceSize = 256;

static bool readFrame(std::vector<std::uint8_t>& pixels) {
    std::size_t offset = 0;
    while (offset < pixels.size()) {
        const ssize_t count = read(STDIN_FILENO, pixels.data() + offset, pixels.size() - offset);
        if (count == 0) return false;
        if (count < 0) {
            if (errno == EINTR) continue;
            std::perror("read");
            return false;
        }
        offset += static_cast<std::size_t>(count);
    }
    return true;
}

int main() {
    if (SDL_Init(SDL_INIT_VIDEO) != 0) {
        std::fprintf(stderr, "SDL_Init: %s\n", SDL_GetError());
        return 1;
    }
    SDL_Window* window = SDL_CreateWindow("Three.js r186 + Dawn/Vulkan on Linux",
                                          SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED,
                                          640, 640, SDL_WINDOW_RESIZABLE);
    if (!window) {
        std::fprintf(stderr, "SDL_CreateWindow: %s\n", SDL_GetError());
        SDL_Quit();
        return 1;
    }
    SDL_Renderer* renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_ACCELERATED);
    if (!renderer) renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_SOFTWARE);
    if (!renderer) {
        std::fprintf(stderr, "SDL_CreateRenderer: %s\n", SDL_GetError());
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }
    SDL_Texture* texture = SDL_CreateTexture(renderer, SDL_PIXELFORMAT_ARGB8888,
                                             SDL_TEXTUREACCESS_STREAMING,
                                             kSourceSize, kSourceSize);
    if (!texture) {
        std::fprintf(stderr, "SDL_CreateTexture: %s\n", SDL_GetError());
        SDL_DestroyRenderer(renderer);
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }
    SDL_RendererInfo info{};
    SDL_GetRendererInfo(renderer, &info);
    std::fprintf(stderr, "window driver=%s, viewer renderer=%s\n",
                 SDL_GetCurrentVideoDriver(), info.name);

    std::vector<std::uint8_t> pixels(kSourceSize * kSourceSize * 4);
    bool running = true;
    while (running && readFrame(pixels)) {
        SDL_Event event;
        while (SDL_PollEvent(&event)) {
            if (event.type == SDL_QUIT ||
                (event.type == SDL_KEYDOWN && event.key.keysym.sym == SDLK_ESCAPE)) {
                running = false;
            }
        }
        SDL_UpdateTexture(texture, nullptr, pixels.data(), kSourceSize * 4);
        SDL_RenderClear(renderer);
        SDL_RenderCopy(renderer, texture, nullptr, nullptr);
        SDL_RenderPresent(renderer);
    }
    SDL_DestroyTexture(texture);
    SDL_DestroyRenderer(renderer);
    SDL_DestroyWindow(window);
    SDL_Quit();
    return 0;
}
