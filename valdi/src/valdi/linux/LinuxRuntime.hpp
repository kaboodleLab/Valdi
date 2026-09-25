//
//  LinuxRuntime.hpp
//  valdi-linux
//

#pragma once

#include "valdi/runtime/RuntimeManager.hpp"
#include "valdi/runtime/Context/ViewNodeTree.hpp"
#include "valdi/standalone_runtime/ValdiStandaloneRuntime.hpp"
#include "valdi_core/cpp/Utils/Shared.hpp"

namespace ValdiLinux {

// Creates a ValdiStandaloneRuntime configured for Linux with the standalone view manager.
Valdi::Ref<Valdi::ValdiStandaloneRuntime> createLinuxRuntime(bool enableDebuggerService,
                                                              bool disableHotReloader);

struct LinuxComponentRuntime {
    Valdi::Ref<Valdi::ValdiStandaloneRuntime> runtime;
    Valdi::SharedViewNodeTree rootViewTree;
};

LinuxComponentRuntime createLinuxComponentRuntime(const char* rootComponentPath,
                                                  int width,
                                                  int height,
                                                  int argc,
                                                  const char** argv);

} // namespace ValdiLinux
