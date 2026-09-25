#include "valdi/linux/LinuxRuntime.hpp"
#include "valdi/runtime/JavaScript/JavaScriptRuntime.hpp"
#include "valdi/runtime/Runtime.hpp"
#include "valdi_core/cpp/Utils/StringCache.hpp"

#include <jsi/jsi.h>

#include <cstdio>

int main() {
    auto standalone = ValdiLinux::createLinuxRuntime(
        /* enableDebuggerService */ false,
        /* disableHotReloader */ true,
        snap::valdi_core::JavaScriptEngineType::Hermes);
    standalone->setupJsRuntime({});

    bool foundJsi = false;
    bool sharesValdiGlobal = false;
    bool valdiSeesJsiGlobal = false;
    auto* runtime = standalone->getRuntime().getJavaScriptRuntime();
    runtime->dispatchSynchronouslyOnJsThread(STRING_LITERAL("three_native_hermes_jsi_probe"),
                                             [&](Valdi::JavaScriptEntryParameters& entry) {
        auto* jsi = entry.jsContext.getJsiRuntime();
        if (jsi == nullptr) return;
        foundJsi = true;

        auto global = jsi->global();
        sharesValdiGlobal = global.hasProperty(*jsi, "valdiStandalone");
        global.setProperty(*jsi, "__nativeWebGPUProbe", 41);

        auto result = entry.jsContext.evaluate(
            "globalThis.__nativeWebGPUProbe + 1", "HermesJsiProbe", entry.exceptionTracker);
        if (entry.exceptionTracker) {
            valdiSeesJsiGlobal = entry.jsContext.valueToInt(result.get(), entry.exceptionTracker) == 42 &&
                                 entry.exceptionTracker;
        }
    });

    std::printf("Hermes JSI: %s; Valdi global: %s; JSI global visible in Valdi: %s\n",
                foundJsi ? "available" : "unavailable",
                sharesValdiGlobal ? "shared" : "missing",
                valdiSeesJsiGlobal ? "yes" : "no");
    return foundJsi && sharesValdiGlobal && valdiSeesJsiGlobal ? 0 : 1;
}
