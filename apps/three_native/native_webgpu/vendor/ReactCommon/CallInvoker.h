#pragma once

#include <functional>

namespace facebook::react {
class CallInvoker {
public:
    virtual ~CallInvoker() = default;
    virtual void invokeAsync(std::function<void()>&& callback) = 0;
    virtual void invokeSync(std::function<void()>&& callback) = 0;
};
}
