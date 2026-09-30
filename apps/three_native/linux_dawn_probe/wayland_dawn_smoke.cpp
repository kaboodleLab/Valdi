#include <SDL3/SDL.h>
#include <webgpu/webgpu.h>

#include <cmath>
#include <cstdio>
#include <cstdlib>

// This is the current-Dawn surface host proof. Its WebGPU device and Wayland
// swapchain are native; the next bridge must expose this device to Valdi's JS
// runtime so Three.WebGPURenderer can submit commands into this same instance.

static void adapterReady(WGPURequestAdapterStatus status, WGPUAdapter adapter,
                         WGPUStringView, void* userdata, void*) {
    if (status == WGPURequestAdapterStatus_Success)
        *static_cast<WGPUAdapter*>(userdata) = adapter;
}

static void deviceReady(WGPURequestDeviceStatus status, WGPUDevice device,
                        WGPUStringView, void* userdata, void*) {
    if (status == WGPURequestDeviceStatus_Success)
        *static_cast<WGPUDevice*>(userdata) = device;
}

static bool waitFor(WGPUInstance instance, WGPUFuture future) {
    WGPUFutureWaitInfo info = WGPU_FUTURE_WAIT_INFO_INIT;
    info.future = future;
    for (int attempt = 0; attempt < 10000; ++attempt) {
        const WGPUWaitStatus status = wgpuInstanceWaitAny(instance, 1, &info, 0);
        if (status == WGPUWaitStatus_Success && info.completed) return true;
        if (status == WGPUWaitStatus_Error) return false;
        SDL_Delay(1);
    }
    return false;
}

int main(int argc, char** argv) {
    const int maxFrames = argc > 1 ? std::atoi(argv[1]) : 0;
    if (!SDL_Init(SDL_INIT_VIDEO)) {
        std::fprintf(stderr, "SDL_Init: %s\n", SDL_GetError());
        return 1;
    }
    SDL_Window* window = SDL_CreateWindow("WorldOS current Dawn direct Wayland surface",
        720, 720, SDL_WINDOW_VULKAN | SDL_WINDOW_RESIZABLE);
    if (!window) { std::fprintf(stderr, "SDL_CreateWindow: %s\n", SDL_GetError()); return 1; }
    SDL_PropertiesID properties = SDL_GetWindowProperties(window);
    void* display = SDL_GetPointerProperty(properties, SDL_PROP_WINDOW_WAYLAND_DISPLAY_POINTER, nullptr);
    void* wlSurface = SDL_GetPointerProperty(properties, SDL_PROP_WINDOW_WAYLAND_SURFACE_POINTER, nullptr);
    if (!display || !wlSurface) {
        std::fprintf(stderr, "SDL did not create a Wayland surface\n");
        return 1;
    }

    WGPUInstance instance = wgpuCreateInstance(nullptr);
    WGPUSurfaceSourceWaylandSurface source = WGPU_SURFACE_SOURCE_WAYLAND_SURFACE_INIT;
    source.display = display;
    source.surface = wlSurface;
    WGPUSurfaceDescriptor surfaceDesc = WGPU_SURFACE_DESCRIPTOR_INIT;
    surfaceDesc.nextInChain = &source.chain;
    WGPUSurface surface = wgpuInstanceCreateSurface(instance, &surfaceDesc);
    if (!surface) { std::fprintf(stderr, "Dawn Wayland surface creation failed\n"); return 1; }

    WGPUAdapter adapter = nullptr;
    WGPURequestAdapterOptions adapterOptions = WGPU_REQUEST_ADAPTER_OPTIONS_INIT;
    adapterOptions.compatibleSurface = surface;
    adapterOptions.backendType = WGPUBackendType_Vulkan;
    WGPURequestAdapterCallbackInfo adapterInfo = WGPU_REQUEST_ADAPTER_CALLBACK_INFO_INIT;
    adapterInfo.mode = WGPUCallbackMode_WaitAnyOnly;
    adapterInfo.callback = adapterReady;
    adapterInfo.userdata1 = &adapter;
    if (!waitFor(instance, wgpuInstanceRequestAdapter(instance, &adapterOptions, adapterInfo)) || !adapter) {
        std::fprintf(stderr, "No Dawn Vulkan adapter for this Wayland surface\n"); return 1;
    }

    WGPUDevice device = nullptr;
    WGPURequestDeviceCallbackInfo deviceInfo = WGPU_REQUEST_DEVICE_CALLBACK_INFO_INIT;
    deviceInfo.mode = WGPUCallbackMode_WaitAnyOnly;
    deviceInfo.callback = deviceReady;
    deviceInfo.userdata1 = &device;
    if (!waitFor(instance, wgpuAdapterRequestDevice(adapter, nullptr, deviceInfo)) || !device) {
        std::fprintf(stderr, "Dawn device request failed\n"); return 1;
    }
    WGPUQueue queue = wgpuDeviceGetQueue(device);
    WGPUSurfaceCapabilities capabilities = WGPU_SURFACE_CAPABILITIES_INIT;
    if (wgpuSurfaceGetCapabilities(surface, adapter, &capabilities) != WGPUStatus_Success
        || capabilities.formatCount == 0) {
        std::fprintf(stderr, "Wayland surface has no supported formats\n"); return 1;
    }
    WGPUTextureFormat format = capabilities.formats[0];
    for (size_t i = 0; i < capabilities.formatCount; ++i)
        if (capabilities.formats[i] == WGPUTextureFormat_BGRA8Unorm)
            format = WGPUTextureFormat_BGRA8Unorm;
    wgpuSurfaceCapabilitiesFreeMembers(capabilities);

    int width = 720, height = 720;
    auto configure = [&] {
        SDL_GetWindowSizeInPixels(window, &width, &height);
        if (width <= 0 || height <= 0) return;
        WGPUSurfaceConfiguration config = WGPU_SURFACE_CONFIGURATION_INIT;
        config.device = device;
        config.format = format;
        config.width = width;
        config.height = height;
        config.presentMode = WGPUPresentMode_Fifo;
        wgpuSurfaceConfigure(surface, &config);
    };
    configure();
    std::printf("Dawn Vulkan direct Wayland surface: %dx%d, format=%u\n",
                width, height, static_cast<unsigned>(format));
    bool running = true;
    int frame = 0;
    int exitCode = 0;
    while (running && (maxFrames <= 0 || frame < maxFrames)) {
        SDL_Event event;
        while (SDL_PollEvent(&event)) {
            if (event.type == SDL_EVENT_QUIT || event.type == SDL_EVENT_WINDOW_CLOSE_REQUESTED ||
                (event.type == SDL_EVENT_KEY_DOWN && event.key.key == SDLK_ESCAPE)) running = false;
            if (event.type == SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED) configure();
        }
        if (!running || width <= 0 || height <= 0) break;
        WGPUSurfaceTexture acquired = WGPU_SURFACE_TEXTURE_INIT;
        wgpuSurfaceGetCurrentTexture(surface, &acquired);
        if (acquired.status == WGPUSurfaceGetCurrentTextureStatus_Outdated ||
            acquired.status == WGPUSurfaceGetCurrentTextureStatus_Lost) {
            configure();
            continue;
        }
        if (!acquired.texture) {
            std::fprintf(stderr, "Swapchain acquire failed: %u\n", static_cast<unsigned>(acquired.status));
            exitCode = 1;
            break;
        }
        WGPUTextureView view = wgpuTextureCreateView(acquired.texture, nullptr);
        WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(device, nullptr);
        WGPURenderPassColorAttachment color = WGPU_RENDER_PASS_COLOR_ATTACHMENT_INIT;
        color.view = view;
        color.loadOp = WGPULoadOp_Clear;
        color.storeOp = WGPUStoreOp_Store;
        const double phase = frame * 0.025;
        color.clearValue = {0.12 + 0.12 * std::sin(phase),
                            0.2 + 0.16 * std::sin(phase + 2),
                            0.32 + 0.18 * std::sin(phase + 4), 1.0};
        WGPURenderPassDescriptor passDesc = WGPU_RENDER_PASS_DESCRIPTOR_INIT;
        passDesc.colorAttachmentCount = 1;
        passDesc.colorAttachments = &color;
        WGPURenderPassEncoder pass = wgpuCommandEncoderBeginRenderPass(encoder, &passDesc);
        wgpuRenderPassEncoderEnd(pass);
        WGPUCommandBuffer command = wgpuCommandEncoderFinish(encoder, nullptr);
        wgpuQueueSubmit(queue, 1, &command);
        wgpuSurfacePresent(surface);
        wgpuCommandBufferRelease(command);
        wgpuRenderPassEncoderRelease(pass);
        wgpuCommandEncoderRelease(encoder);
        wgpuTextureViewRelease(view);
        wgpuTextureRelease(acquired.texture);
        ++frame;
        SDL_Delay(16);
    }
    std::printf("Presented %d native Wayland frames\n", frame);
    wgpuSurfaceUnconfigure(surface);
    wgpuQueueRelease(queue);
    wgpuDeviceRelease(device);
    wgpuAdapterRelease(adapter);
    wgpuSurfaceRelease(surface);
    wgpuInstanceRelease(instance);
    SDL_DestroyWindow(window);
    SDL_Quit();
    return exitCode;
}
