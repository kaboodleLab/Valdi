//
//  LinuxRuntime.cpp
//  valdi-linux
//

#include "valdi/linux/LinuxRuntime.hpp"

#include "valdi/jsbridge/JavaScriptBridge.hpp"
#include "valdi/runtime/Runtime.hpp"
#include "valdi/standalone_runtime/InMemoryDiskCache.hpp"
#include "valdi/standalone_runtime/StandaloneMainQueue.hpp"
#include "valdi/standalone_runtime/StandaloneResourceLoader.hpp"
#include "valdi_core/cpp/Context/PlatformType.hpp"
#include "valdi_core/cpp/Utils/StringCache.hpp"
#include "valdi_core/cpp/Views/Frame.hpp"

#include <utility>
#include <vector>

namespace ValdiLinux {

Valdi::Ref<Valdi::ValdiStandaloneRuntime> createLinuxRuntime(bool enableDebuggerService,
                                                              bool disableHotReloader) {
    auto mainQueue = Valdi::makeShared<Valdi::StandaloneMainQueue>();
    auto diskCache = Valdi::makeShared<Valdi::InMemoryDiskCache>();
    auto resourceLoader = Valdi::makeShared<Valdi::StandaloneResourceLoader>();

    return Valdi::ValdiStandaloneRuntime::create(enableDebuggerService,
                                                 disableHotReloader,
                                                 /* enableViewPreloader */ false,
                                                 /* registerCustomAttributes */ true,
                                                 /* keepAttributesHistory */ false,
                                                 Valdi::JavaScriptBridge::get(),
                                                 mainQueue,
                                                 diskCache,
                                                 /* runtimeListener */ nullptr,
                                                 resourceLoader,
                                                 /* tweakValueProvider */ nullptr,
                                                 Valdi::PlatformTypeLinux);
}

LinuxComponentRuntime createLinuxComponentRuntime(const char* rootComponentPath,
                                                  int width,
                                                  int height,
                                                  int argc,
                                                  const char** argv) {
    auto runtime = createLinuxRuntime(/* enableDebuggerService */ false,
                                      /* disableHotReloader */ true);
    runtime->getResourceLoader().addModuleSearchDirectory(STRING_LITERAL("."));

    std::vector<Valdi::StringBox> jsArguments;
    for (int i = 1; i < argc; ++i) {
        jsArguments.push_back(Valdi::StringBox::fromCString(argv[i]));
    }

    runtime->setupJsRuntime(jsArguments);
    auto rootViewTree = runtime->getRuntime().createViewNodeTreeAndContext(
        runtime->getViewManagerContext(), Valdi::StringBox::fromCString(rootComponentPath));
    rootViewTree->setRootViewWithDefaultViewClass();
    rootViewTree->setRetainsLayoutSpecsOnInvalidateLayout(true);
    rootViewTree->setLayoutSpecs(Valdi::Size(width, height), Valdi::LayoutDirectionLTR);
    return {std::move(runtime), std::move(rootViewTree)};
}

} // namespace ValdiLinux
