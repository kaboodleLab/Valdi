// Development-only JSON bridge: Valdi runs TypeScript state; the shared Rust kit owns UI.
#include "valdi/linux/LinuxRuntime.hpp"
#include "valdi/standalone_runtime/StandaloneMainQueue.hpp"
#include "valdi/standalone_runtime/StandaloneResourceLoader.hpp"
#include "valdi/runtime/Runtime.hpp"
#include "valdi/runtime/JavaScript/JavaScriptRuntime.hpp"
#include "valdi_core/cpp/Utils/ValueFunctionWithCallable.hpp"
#include "valdi_core/cpp/Utils/ValueUtils.hpp"
#include "valdi_core/cpp/Utils/JSONWriter.hpp"
#include "valdi_core/cpp/Utils/StringCache.hpp"
#include <poll.h>
#include <unistd.h>
#include <iostream>
#include <mutex>
int main() {
    auto runtime = ValdiLinux::createLinuxRuntime(false, true);
    runtime->getResourceLoader().addModuleSearchDirectory(STRING_LITERAL("."));
    std::mutex mutex;
    Valdi::Ref<Valdi::ValueFunction> handler;
    Valdi::Value host;
    host.setMapValue("subscribe", Valdi::Value(Valdi::makeShared<Valdi::ValueFunctionWithCallable>(
        [&](const Valdi::ValueFunctionCallContext& call) {
            std::lock_guard<std::mutex> lock(mutex);
            handler = call.getParameterAsFunction(0); return Valdi::Value();
        })));
    host.setMapValue("emit", Valdi::Value(Valdi::makeShared<Valdi::ValueFunctionWithCallable>(
        [&](const Valdi::ValueFunctionCallContext& call) {
            auto body = Valdi::valueToJsonString(call.getParameter(0));
            if (body.size() > 262144) { return Valdi::Value(false); }
            std::cout << body << '\n' << std::flush; return Valdi::Value(true);
        })));
    runtime->getRuntime().getJavaScriptRuntime()->setValueToGlobalObject(STRING_LITERAL("spatialHost"), host);
    // evalScript enables automatic exit when no Valdi views/tasks remain. This viewless host
    // owns its lifetime through the pipe, so initialize and load without that coordinator.
    runtime->setupJsRuntime({});
    {
        auto loaded = runtime->getRuntime().getJavaScriptRuntime()->evalModuleSync(
            STRING_LITERAL("linux_spatial_kit/src/valdi"), false);
        if (!loaded) { std::cerr << loaded.error().toString() << '\n'; return 1; }
    }
    std::string pending;
    bool open = true;
    while (open && !runtime->getMainQueue()->isDisposed()) {
        runtime->getMainQueue()->flushUpToNow();
        pollfd input {STDIN_FILENO, POLLIN, 0};
        int result = poll(&input, 1, 10);
        if (result < 0) { return 1; }
        if (result > 0 && (input.revents & (POLLIN | POLLHUP))) {
            char chunk[4096]; auto count = read(STDIN_FILENO, chunk, sizeof(chunk));
            if (count <= 0) { open = false; break; }
            pending.append(chunk, static_cast<size_t>(count));
            if (pending.size() > 8192) { return 2; }
            size_t newline;
            while ((newline = pending.find('\n')) != std::string::npos) {
                if (newline > 4096) { return 2; }
                auto value = Valdi::correctJsonToValue(pending.substr(0, newline));
                pending.erase(0, newline + 1);
                Valdi::Ref<Valdi::ValueFunction> callback;
                { std::lock_guard<std::mutex> lock(mutex); callback = handler; }
                if (value && callback != nullptr) { (*callback)(&value.value(), 1); }
            }
        }
    }
    // Allow the final queued script callback to publish before dropping the runtime.
    runtime->getMainQueue()->flushUpToNow();
    handler = nullptr;
    runtime = nullptr;
    return 0;
}
