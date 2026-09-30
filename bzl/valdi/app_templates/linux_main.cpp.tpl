#include "valdi/linux/Bootstrap/ValdiLinuxMain.hpp"

int main(int argc, const char** argv) {
    return ValdiLinux::valdiLinuxMain("@VALDI_ROOT_COMPONENT_PATH@",
                                     @VALDI_WINDOW_WIDTH@,
                                     @VALDI_WINDOW_HEIGHT@,
                                     argc,
                                     argv);
}
