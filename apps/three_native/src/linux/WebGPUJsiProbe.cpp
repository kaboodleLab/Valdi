#include "RNWebGPUManager.h"
#include "valdi/linux/LinuxRuntime.hpp"
#include "valdi/runtime/JavaScript/JavaScriptRuntime.hpp"
#include "valdi/runtime/Runtime.hpp"
#include "valdi_core/cpp/Utils/StringCache.hpp"

#include <jsi/jsi.h>

#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <memory>
#include <mutex>

namespace {

struct ProbeResult {
    std::mutex mutex;
    std::condition_variable changed;
    bool finished = false;
    bool hasAdapter = false;
};

} // namespace

int main() {
    auto standalone = ValdiLinux::createLinuxRuntime(
        false, true, snap::valdi_core::JavaScriptEngineType::Hermes);
    standalone->setupJsRuntime({});
    auto* runtime = standalone->getRuntime().getJavaScriptRuntime();
    auto result = std::make_shared<ProbeResult>();
    std::unique_ptr<rnwgpu::RNWebGPUManager> webgpu;
    bool installed = false;
    bool hasTimer = false;

    runtime->dispatchSynchronouslyOnJsThread(STRING_LITERAL("install_native_webgpu"),
                                             [&](Valdi::JavaScriptEntryParameters& entry) {
        auto* jsi = entry.jsContext.getJsiRuntime();
        if (jsi == nullptr) return;
        auto global = jsi->global();
        hasTimer = global.hasProperty(*jsi, "setTimeout");
        if (!hasTimer) {
            auto timer = facebook::jsi::Function::createFromHostFunction(
                *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "setTimeout"), 2,
                [runtime](facebook::jsi::Runtime& js,
                          const facebook::jsi::Value&,
                          const facebook::jsi::Value* args,
                          size_t count) -> facebook::jsi::Value {
                    if (count == 0 || !args[0].isObject()) return facebook::jsi::Value::undefined();
                    auto callback = std::make_shared<facebook::jsi::Function>(args[0].asObject(js).asFunction(js));
                    runtime->dispatchOnJsThread(
                        STRING_LITERAL("native_webgpu_timer"), Valdi::JavaScriptTaskScheduleTypeAlwaysAsync, 1,
                        [callback](Valdi::JavaScriptEntryParameters& task) {
                            if (auto* taskJsi = task.jsContext.getJsiRuntime()) callback->call(*taskJsi);
                        });
                    return facebook::jsi::Value(1);
                });
            global.setProperty(*jsi, "setTimeout", std::move(timer));
        }

        auto done = facebook::jsi::Function::createFromHostFunction(
            *jsi, facebook::jsi::PropNameID::forAscii(*jsi, "__webgpuProbeDone"), 1,
            [result](facebook::jsi::Runtime&,
                     const facebook::jsi::Value&,
                     const facebook::jsi::Value* args,
                     size_t count) -> facebook::jsi::Value {
                {
                    std::lock_guard<std::mutex> lock(result->mutex);
                    result->hasAdapter = count > 0 && args[0].isBool() && args[0].getBool();
                    result->finished = true;
                }
                result->changed.notify_one();
                return facebook::jsi::Value::undefined();
            });
        global.setProperty(*jsi, "__webgpuProbeDone", std::move(done));

        // This probe exercises the WebGPU API and async Dawn callbacks. Surface
        // and image methods are not called, so the platform context is absent.
        webgpu = std::make_unique<rnwgpu::RNWebGPUManager>(jsi, nullptr, nullptr);
        installed = true;
        entry.jsContext.evaluate(
            "RNWebGPU.gpu.requestAdapter().then("
            "adapter => __webgpuProbeDone(!!adapter), "
            "error => { console.error(error); __webgpuProbeDone(false); })",
            "WebGPUJsiProbe", entry.exceptionTracker);
    });

    bool completed = false;
    {
        std::unique_lock<std::mutex> lock(result->mutex);
        completed = result->changed.wait_for(lock, std::chrono::seconds(15), [&] { return result->finished; });
    }
    runtime->dispatchSynchronouslyOnJsThread(STRING_LITERAL("dispose_native_webgpu"),
                                             [&](Valdi::JavaScriptEntryParameters&) { webgpu.reset(); });

    std::printf("WebGPU JSI installed: %s; Valdi timer: %s; Dawn adapter: %s\n",
                installed ? "yes" : "no", hasTimer ? "yes" : "provided",
                completed && result->hasAdapter ? "available" : "unavailable");
    return installed && completed && result->hasAdapter ? 0 : 1;
}
