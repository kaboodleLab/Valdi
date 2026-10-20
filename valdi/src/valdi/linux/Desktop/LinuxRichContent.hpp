#pragma once
#include <cstdint>
#include <memory>
#include <string>
struct SDL_Window;
namespace ValdiLinux {
// Owns only its proxies on SDL's borrowed Wayland display/surface, on the SDL event thread.
class LinuxRichContent {
public:
    explicit LinuxRichContent(SDL_Window* window);
    ~LinuxRichContent();
    void publish(const std::string& snapshot);
    void pump();
    uint32_t acceptedRevision() const;
    uint32_t rejectedCount() const;
private:
    class Impl;
    std::unique_ptr<Impl> _impl;
};
}
