load("@rules_cc//cc:defs.bzl", "cc_binary")
load("//bzl:expand_template.bzl", "expand_template")

def valdi_linux_application(
        name,
        root_component_path,
        deps = []):
    main_target = "{}_maingen".format(name)

    expand_template(
        name = main_target,
        src = "@valdi//bzl/valdi/app_templates:linux_main.cpp.tpl",
        output = "main_linux.cpp",
        substitutions = {
            "@VALDI_ROOT_COMPONENT_PATH@": root_component_path,
        },
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

def valdi_linux_desktop_application(name, title, root_component_path, deps = []):
    main_target = "{}_maingen".format(name)
    expand_template(
        name = main_target,
        src = "@valdi//bzl/valdi/app_templates:linux_desktop_main.cpp.tpl",
        output = "main_linux_desktop.cpp",
        substitutions = {
            "@VALDI_ROOT_COMPONENT_PATH@": root_component_path,
            "@VALDI_TITLE@": title,
        },
    )
    cc_binary(
        name = name,
        srcs = [":" + main_target],
        deps = ["@valdi//valdi:valdi_linux_desktop"] + deps,
        target_compatible_with = ["@platforms//os:linux"],
        visibility = ["//visibility:public"],
    )
