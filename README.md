[releases]: https://github.com/ZenesisUK/qx-build-vscode/releases
[proxies]: https://qooxdoo.org/documentation/v7.6/#/development/compiler/configuration/compile?id=targets

# QX Build VSCode

Automatically build Qooxdoo applications in Visual Studio Code.

## Installation

Currentrly QX Build is not available on the VSCode Marketplace. Instead, you can
install the latest version of the extension from the [releases page][releases].

The JSON config file used by QX Build is called `qx.build`, as VSCode may not
automatically recognise this as JSON it may be useful to add the following
option to `files.associations` in your `settings.json`:

```json
"files.associations": {
  "qx.build": "json"
},
```

## Commands

- `QX Build VSCode: Build Once...` (`qx-build-vscode.buildOnce`)
  - Builds the selected task(s) once. Select one task, all tasks in a workspace,
    or all workspaces
- `QX Build VSCode: Build Watch...` (`qx-build-vscode.buildWatch`)
  - Builds the selected task, restarting on changes to source files
- `QX Build VSCode: Stop Builder...` (`qx-build-vscode.stopBuilder`)
  - Stops the selected task(s). Select one task, all tasks in a workspace, or
    all workspaces
- ``QX Build: Create Sample `qx.build` file`` (`qx-build-vscode.sampleQxBuild`)
  - Creates an unsaved sample configuration file to be saved to your target
    workspace
- `QX Build: Inspect Resolved Config...` (`qx-build-vscode.inspectConfig`)
  - Shows the resolved configuration for the selected task. Can be useful if
    a configuration behaves unexpectedly

## `qx.build` Configuration

Adding a `qx.build` file to the root of a workspace enables complete
customisation of the build process(es).

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/zenesisUK/qx-build-vscode/refs/heads/main/src/qx.build.schema.json",
  "autostart": "My Qooxdoo App",
  "builders": [
    {
      // the name of the task
      "name": "My Qooxdoo App",
      // the path from which all commands will be run
      "workDir": ".",
      // whether to start building with file watcher on startup
      "compilerArgs": [
        // additional arguments to `qx compile`
        "-T"
      ],
      "preBuild": [
        // commands to run before the build starts
        "echo \"I'm a preBuild command\""
      ],
      "postBuild": [
        // commands to run after the build completes
        "echo \"I'm a postBuild command\""
      ],
      "sourcePaths": [
        // reads `compile.json`, then extracts `libraries` array.
        // also works for nested objects.
        "compile.json#libraries"
      ]
    }
  ]
}
```

Any number of builders can be defined in a single `qx.build` file, making it
easy to configure build processes in both single-project repos and monorepos and
to build in all the ways your use case requires.

Alongside the builders array there is the optional `autostart` field. If
provided, this field must be an exact match to the `name` field of one of the
builders. Whichever builder it refers to will be started automatically when the
extension is activated.

### Builder Options

**name**: The name of the task. This will be displayed in selection menus and in
the title of the output channel for the builder.

**workDir**: The working directory of the builder. This will be the working
directory for the `qx compile` command and for any pre- and post-build commands.

**compilerArgs**: Additional arguments to pass to `qx compile`. This can be used
to convert a builder into a production builder with `--target <target>`, or to
temporarily enable verbose debugging options such as `--verbose-created-at`. May
include [json pointers](#json-pointer) and [build pointers](#build-pointer),

**preBuild**: Commands to run before the build starts. This can be used to do
*anything* immediately prior to each compilation. For example, you can execute a
script to generate [proxy classes][proxies]. May include
[json pointers](#json-pointer) and [build pointers](#build-pointer),

**postBuild**: Commands to run after the build completes. This can be used to do
*anything* immediately after each compilation. For example, you may want to
signal to a separate web server that the build has completed. May include
[json pointers](#json-pointer) and [build pointers](#build-pointer),

**sourcePaths**: An array of paths to read from the workspace. May include
[json pointers](#json-pointer) and[build pointers](#build-pointer).

### JSON Pointer

A JSON pointer is a simple way to reference nested content in other JSON files.

The general syntax is `<path to json file>#<dotpath to nested value>`, where
`<path to json file>` is a relative or absolute path to a JSON file, and
`<dotpath to nested value>` is a dot-separated path to the desired value within
the JSON file.

For example, `compile.json#libraries` will read the top-level `libraries` array
from the `compile.json` file in the workspace.

To read a JSON file who's root object is the array to capture, simply omit the
dotpath while keeping the `#` separator.

For example, `sourcePaths.json#` will read the entire contents of the
`sourcePaths.json` file in the workspace.

The target file does not have to have a `.json` extension. QX Build only cares
that the `#` separator is present, the path merely needs to point to a file in
JSON format.

### Build Pointer

Similar to a [JSON pointer](#json-pointer), a build pointer is a way to
reference the configuration of other builders.

The general syntax is `<path to builder>@<builder name>`, where
`<path to builder>` is a relative or absolute path to a `qx.build` file, and
`<builder name>` is the name of the builder to copy configuration from.

For example, `../other-project/@My Qooxdoo App` will copy the configuration of
the `My Qooxdoo App` builder from the `qx.build` file in `../other-project`.

The particular configuration option copied is always the same option as the
build pointer is added to. For example, a build pointer in the `sourcePaths`
array can only copy from the `sourcePaths` array of the target builder.

To copy from a builder in the same file, either omit the file path section or
use a path pointing to the current file.

For example, `@My Qooxdoo App`, `.@My Qooxdoo App`, `../my-app@My Qooxdoo App`,
etc, will copy the configuration of the `My Qooxdoo App` builder from the same
`qx.build` file.

It's important not to include the `qx.build` filename in the path section.
Internally, build pointers are validated via `fs.readdir`, as such they need a
path to a directory, not a file.

## Multiple Workspaces & Nested Projects

On startup QX Build will scan all open workspaces recursively for `compile.json`
files. Then with each found `compile.json` file, QX Build will watch for changes
to the `qx.build` file in the same directory - even if that file does not yet
exist.
From there, any changes to a `qx.build` file (including create or delete) will
trigger QX Build to re-read the configuration and update the effected builders.
Note that this does not stop any currently running builds or watched builds.