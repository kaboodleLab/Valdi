//
//  ValdiLinuxMain.cpp
//  valdi-linux
//

#include "valdi/linux/Bootstrap/ValdiLinuxMain.hpp"
#include "valdi/linux/LinuxRuntime.hpp"
#include "valdi/standalone_runtime/StandaloneMainQueue.hpp"

namespace ValdiLinux {

int valdiLinuxMain(const char* rootComponentPath, int width, int height, int argc, const char** argv) {
    auto component = createLinuxComponentRuntime(rootComponentPath, width, height, argc, argv);
    return component.runtime->getMainQueue()->runIndefinitely();
}

} // namespace ValdiLinux
