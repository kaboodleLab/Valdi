#include "valdi/linux/Desktop/LinuxRichContent.hpp"
#include "valdi/spaos-content-client.h"
#include <SDL3/SDL.h>
#include <wayland-client.h>
#include <cstring>
#include <iostream>
#include <limits>

namespace ValdiLinux {
class LinuxRichContent::Impl {
public:
    wl_display* display = nullptr;
    wl_surface* surface = nullptr;
    wl_event_queue* queue = nullptr;
    wl_registry* registry = nullptr;
    zspaos_content_manager_v1* manager = nullptr;
    zspaos_content_v1* content = nullptr;
    std::string latest, sent, handled;
    uint32_t sequence = 0, revision = 0, rejections = 0;
    bool waiting = false;
    uint64_t retryAfter = 0;
    unsigned retries = 0;

    explicit Impl(SDL_Window* window) {
        auto props = SDL_GetWindowProperties(window);
        display = static_cast<wl_display*>(SDL_GetPointerProperty(props, SDL_PROP_WINDOW_WAYLAND_DISPLAY_POINTER, nullptr));
        surface = static_cast<wl_surface*>(SDL_GetPointerProperty(props, SDL_PROP_WINDOW_WAYLAND_SURFACE_POINTER, nullptr));
        if (!display || !surface) { return; }
        queue = wl_display_create_queue(display);
        if (!queue) { return; }
        registry = wl_display_get_registry(display);
        wl_proxy_set_queue(reinterpret_cast<wl_proxy*>(registry), queue);
        static const wl_registry_listener listener {
            [](void* data, wl_registry* registry, uint32_t name, const char* interface, uint32_t version) {
                auto& self = *static_cast<Impl*>(data);
                if (self.manager || std::strcmp(interface, "zspaos_content_manager_v1") || version < 1) { return; }
                self.manager = static_cast<zspaos_content_manager_v1*>(wl_registry_bind(registry, name, &zspaos_content_manager_v1_interface, 1));
                self.content = zspaos_content_manager_v1_get_content(self.manager, self.surface);
                static const zspaos_content_v1_listener replies {
                    [](void* data, zspaos_content_v1*, uint32_t seq, uint32_t rev) {
                        auto& s = *static_cast<Impl*>(data);
                        if (seq != s.sequence) { return; }
                        s.revision = rev; s.waiting = false; s.handled = s.sent; s.retries = 0;
                        std::cout << "VALDI_CONTENT_ACCEPTED=" << seq << ':' << rev << std::endl;
                    },
                    [](void* data, zspaos_content_v1*, uint32_t seq, uint32_t rev, const char* reason) {
                        auto& s = *static_cast<Impl*>(data);
                        if (seq != s.sequence) { return; }
                        s.revision = rev; s.waiting = false; ++s.rejections;
                        bool transient = std::strstr(reason, "not mapped") || std::strstr(reason, "stale surface") || std::strstr(reason, "busy") || std::strstr(reason, "stale revision");
                        if (transient && ++s.retries <= 5) { s.retryAfter = SDL_GetTicks() + 200; }
                        else { s.handled = s.sent; }
                        std::cerr << "Rich content rejected: " << reason << '\n';
                    }
                };
                zspaos_content_v1_add_listener(self.content, &replies, &self);
                std::cout << "VALDI_CONTENT_PROTOCOL=experimental/1" << std::endl;
            },
            [](void*, wl_registry*, uint32_t) {}
        };
        wl_registry_add_listener(registry, &listener, this);
        wl_display_flush(display);
    }
    ~Impl() {
        if (content) { zspaos_content_v1_destroy(content); }
        if (manager) { zspaos_content_manager_v1_destroy(manager); }
        if (registry) { wl_registry_destroy(registry); }
        if (queue) { wl_event_queue_destroy(queue); }
    }
    void pump() {
        if (!queue) { return; }
        // SDL reads the display fd. Dispatch only our already-queued events; never roundtrip/wait.
        if (wl_display_dispatch_queue_pending(display, queue) < 0) { return; }
        if (content && !waiting && !latest.empty() && latest != handled && SDL_GetTicks() >= retryAfter && sequence < std::numeric_limits<uint32_t>::max()) {
            sent = latest; waiting = true;
            zspaos_content_v1_submit(content, ++sequence, revision, sent.c_str());
            wl_display_flush(display);
        }
    }
};
LinuxRichContent::LinuxRichContent(SDL_Window* window) : _impl(std::make_unique<Impl>(window)) {}
LinuxRichContent::~LinuxRichContent() = default;
void LinuxRichContent::publish(const std::string& snapshot) {
    if (snapshot.size() <= 61440 && snapshot != _impl->latest) { _impl->latest = snapshot; _impl->retries = 0; }
}
void LinuxRichContent::pump() { _impl->pump(); }
uint32_t LinuxRichContent::acceptedRevision() const { return _impl->revision; }
uint32_t LinuxRichContent::rejectedCount() const { return _impl->rejections; }
}
