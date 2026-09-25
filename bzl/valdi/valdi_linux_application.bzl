load("@rules_cc//cc:defs.bzl", "cc_binary")
load("//bzl:expand_template.bzl", "expand_template")

def valdi_linux_application(
        name,
        root_component_path,
        window_width = 600,
        window_height = 800,
        windowed = False,
        deps = []):
    main_target = "{}_maingen".format(name)
    substitutions = {
        "@VALDI_ROOT_COMPONENT_PATH@": root_component_path,
        "@VALDI_WINDOW_WIDTH@": str(window_width),
        "@VALDI_WINDOW_HEIGHT@": str(window_height),
    }

    expand_template(
        name = main_target,
        src = "@valdi//bzl/valdi/app_templates:linux_main.cpp.tpl",
        output = "main_linux.cpp",
        substitutions = substitutions,
    )

    cc_binary(
        name = name,
        srcs = [":{}".format(main_target)],
        target_compatible_with = ["@platforms//os:linux"],
        tags = ["valdi_linux_application"],
        visibility = ["//visibility:public"],
        deps = [
            "@valdi//valdi",
            "@valdi//valdi:valdi_linux",
        ] + deps,
    )

    if windowed:
        window_main_target = "{}_window_maingen".format(name)
        expand_template(
            name = window_main_target,
            src = "@valdi//bzl/valdi/app_templates:linux_sdl_main.cpp.tpl",
            output = "main_linux_sdl.cpp",
            substitutions = substitutions,
        )

        cc_binary(
            name = "{}_window".format(name),
            srcs = [":{}".format(window_main_target)],
            target_compatible_with = ["@platforms//os:linux"],
            tags = ["valdi_linux_application"],
            visibility = ["//visibility:public"],
            deps = [
                "@valdi//valdi",
                "@valdi//valdi:valdi_linux",
                "@valdi//valdi:valdi_linux_sdl_host",
            ] + deps,
        )
