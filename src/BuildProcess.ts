import * as vscode from "vscode";
import { TypedEventTarget } from "./util/TypedEventTarget.js";
import childProcess from "child_process";
import fs from "fs";
import path from "path";
import { Diagnostics } from "./Diagnostics.js";
import { isPojo, isStringArray, keyIsArrayOfString, keyIsString, removeDuplicates } from "./util/validate.js";
import { handlePointers } from "./util/pointers.js";

export type BuildProcessData = {
  /**
   * The name of the build process to display in the UI
   */
  name: string;
  /**
   * The working directory for the build process, relative to the qx.build file
   */
  workDir: string;
  /**
   * Whether this build should automatically begin running when the extension is activated
   */
  autoRun: boolean;
  /**
   * Additional command line arguments to pass to `qx compile`
   */
  compilerArgs: string[];
  /**
   * Array of setup commands to run before the build process
   *
   * These commands will be run in the same shell session as the `qx compile` command
   */
  preBuild: string[];
  /**
   * Array of cleanup commands to run after the build process
   *
   * These commands will be run in the same shell session as the `qx compile` command
   */
  postBuild: string[];
  /**
   * Additional paths to watch for changes
   *
   * Paths are resolved relative to the `workDir`, and may be either absolute or relative.
   *
   * Paths can also be loaded from JSON files, for example to read the `libraries` property from a `compile.json` file
   * add `"compile.json#libraries"` to the array
   */
  sourcePaths: string[];
};

export class CompilerOutputEvent extends Event {
  constructor(name: string, public readonly data: string, public readonly source: "stdout" | "stderr") {
    super(name);
  }
}

type BuildProcessEventMap = {
  data: CompilerOutputEvent;
  restart: Event;
};

export class BuildProcess extends TypedEventTarget<BuildProcessEventMap> {
  public static qxBuildFileFor(workspace: vscode.WorkspaceFolder) {
    return vscode.Uri.joinPath(workspace.uri, "qx.build").fsPath;
  }

  private static validateNormalize(data: any, defaultWorkDir: string): BuildProcessData {
    if (!isPojo(data)) throw new Error("qx.build file must contain an object.");

    const allowedKeys = ["name", "workDir", "compilerArgs", "preBuild", "postBuild", "sourcePaths", "autoRun"];
    for (const key in data) {
      if (key === "$schema") continue;
      if (!allowedKeys.includes(key)) {
        throw new Error(
          `Unknown key: '${key}', expected only the following keys: ${allowedKeys.map(i => `'${i}'`).join(", ")}`,
        );
      }
    }

    let currentKey: string;
    try {
      currentKey = "name";
      if (!("name" in data)) data.name = crypto.randomUUID().split("-")[0];
      if (!keyIsString("name", data)) throw new Error("Key 'name' must be a string.");

      currentKey = "workDir";
      if (!("workDir" in data)) data.workDir = defaultWorkDir;
      if (!keyIsString("workDir", data)) throw new Error("Key 'workDir' must be a string.");
      data.workDir = path.resolve(defaultWorkDir, data.workDir);

      for (let key of ["compilerArgs", "preBuild", "postBuild", "sourcePaths"] as const) {
        currentKey = key;
        if (!(key in data)) data[key] = [];
        if (!keyIsArrayOfString(key, data)) throw new Error("Key 'key' must be an array of strings.");
        data[key] = handlePointers(data[key], data.workDir, key);
        data[key] = removeDuplicates(data[key]);
      }
    } catch (cause) {
      if (!(cause instanceof Error)) throw cause;
      throw new Error(`Error validating configuration: ${currentKey!}: ${cause}`);
    }

    if (!("autoRun" in data)) data.autoRun = false;
    if (typeof data.autoRun !== "boolean") throw new Error("Key 'autoRun' must be a boolean.");

    return data as BuildProcessData;
  }

  private static diagnosticsChannel?: vscode.OutputChannel;

  public static createFor(
    context: vscode.ExtensionContext,
    workspace: vscode.WorkspaceFolder,
    existingInstance?: BuildProcess,
  ) {
    BuildProcess.diagnosticsChannel ??= vscode.window.createOutputChannel("QX Build Diagnostics");
    const qxBuildFile = this.qxBuildFileFor(workspace);
    const qxBuildFileContents = fs.readFileSync(qxBuildFile, "utf-8");
    try {
      const qxBuildFileJson = JSON.parse(qxBuildFileContents);
      if (!("builders" in qxBuildFileJson)) throw new Error("qx.build#builders is missing.");
      if (!Array.isArray(qxBuildFileJson.builders)) throw new Error("qx.build#builders must be an array.");
      const buildProcesses = new Map<string, BuildProcess>();
      for (const configuration of qxBuildFileJson.builders) {
        const qxBuildFileData = BuildProcess.validateNormalize(configuration, workspace.uri.fsPath);
        if (existingInstance) {
          existingInstance.updateData(qxBuildFileData);
          buildProcesses.set(qxBuildFileData.name, existingInstance);
          continue;
        }
        const buildProcess = new BuildProcess(qxBuildFileData);
        buildProcess.diagnostics = new Diagnostics(context, BuildProcess.diagnosticsChannel, workspace, buildProcess);
        buildProcesses.set(qxBuildFileData.name, buildProcess);
      }
      return buildProcesses;
    } catch (cause) {
      if (!(cause instanceof Error)) throw cause;
      vscode.window.showErrorMessage(`Failed to parse ${qxBuildFile}: ${cause.message}`);
      return null;
    }
  }

  constructor(data: BuildProcessData) {
    super();
    this.updateData(data);
    if (this.autoRun) this.start();
  }

  public diagnostics!: Diagnostics;
  #name!: string;
  public get name() {
    return this.#name;
  }
  private set name(name: string) {
    this.#name = name;
  }
  #workDir!: string;
  public get workDir() {
    return this.#workDir;
  }
  private set workDir(workDir: string) {
    this.#workDir = workDir;
  }
  #compilerArgs!: string[];
  public get compilerArgs() {
    return this.#compilerArgs;
  }
  private set compilerArgs(compilerArgs: string[]) {
    this.#compilerArgs = compilerArgs;
  }
  #preBuild!: string[];
  public get preBuild() {
    return this.#preBuild;
  }
  private set preBuild(preBuild: string[]) {
    this.#preBuild = preBuild;
  }
  #postBuild!: string[];
  public get postBuild() {
    return this.#postBuild;
  }
  private set postBuild(postBuild: string[]) {
    this.#postBuild = postBuild;
  }
  #sourcePaths!: string[];
  public get sourcePaths() {
    return this.#sourcePaths;
  }
  private set sourcePaths(sourcePaths: string[]) {
    this.#sourcePaths = sourcePaths;
  }
  #autoRun!: boolean;
  public get autoRun() {
    return this.#autoRun;
  }
  private set autoRun(autoRun: boolean) {
    this.#autoRun = autoRun;
  }

  public toJson() {
    return {
      name: this.name,
      workDir: this.workDir,
      compilerArgs: this.compilerArgs,
      preBuild: this.preBuild,
      postBuild: this.postBuild,
      sourcePaths: this.sourcePaths,
      autoRun: this.autoRun,
    };
  }

  private channel!: vscode.OutputChannel;
  private process?: childProcess.ChildProcess;
  private watchers: fs.FSWatcher[] = [];

  public updateData({ name, workDir, compilerArgs, preBuild, postBuild, sourcePaths, autoRun }: BuildProcessData) {
    this.name = name;
    this.workDir = workDir;
    this.compilerArgs = compilerArgs;
    this.preBuild = preBuild;
    this.postBuild = postBuild;
    this.sourcePaths = sourcePaths;
    this.autoRun = autoRun;

    const channelName = `QX Build: ${this.name}`;
    if (this.channel && this.channel.name !== channelName) this.channel.dispose();
    this.channel = vscode.window.createOutputChannel(channelName);
    if (autoRun || this.isWatching) {
      vscode.window.showInformationMessage(`Restarting build process for ${this.name}`);
      this.channel.appendLine(`Restarting build process for ${this.name}`);
      this.stop();
      this.start();
    }
  }

  public get isWatching() {
    return !!this.watchers.length;
  }
  public get isRunning() {
    return !!this.process;
  }

  public start() {
    if (this.isWatching) return;
    this.channel.show();
    this.channel.appendLine("Building with watcher...");
    this.build();
    for (const sourcePath of this.sourcePaths) {
      const target = path.resolve(this.workDir, sourcePath);
      let x = 1;
      this.channel.appendLine(`Added watch target: ${target}`);
      const watcher = fs.watch(target, { recursive: true }, (_, filepath) => {
        if (!filepath) return;
        if (!filepath.endsWith(".js") && !filepath.endsWith(".ts")) return;
        this.build();
      });
      this.watchers.push(watcher);
      watcher.on("close", () => {
        if (!this.watchers.includes(watcher)) return;
        this.watchers.splice(this.watchers.indexOf(watcher), 1);
      });
    }
  }

  public build(oneOff = false) {
    if (oneOff) {
      this.channel.show();
      this.channel.appendLine("Building once...");
    }
    this.dispatchEvent(new Event("restart"));
    const startSignal = "####START####";
    const endSignal = "####END####";

    let enable = false;
    const onStdout = (data: string) => {
      data = data.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (data === startSignal) enable = true;
      else if (data === endSignal) enable = false;
      else {
        if (enable) this.dispatchEvent(new CompilerOutputEvent("data", data, "stdout"));
        this.channel.appendLine(`[stdout]: ${data}`);
      }
    };
    const onStderr = (data: string) => {
      data = data.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (enable) this.dispatchEvent(new CompilerOutputEvent("data", data, "stderr"));
      this.channel.appendLine(`[stderr]: ${data}`);
    };
    const lineByLine = (cb: (data: string) => void) => (data: string) =>
      data
        .split("\n")
        .filter(line => !!line.trim().length)
        .forEach(cb);

    const command =
      "sleep 1 ; " +
      // prebuild
      (this.preBuild.length ? 'echo "Running prebuild..." ; ' : "") +
      this.preBuild.join(" && ") +
      (this.preBuild.length ? " && " : "") +
      // compiler
      'echo "Running compiler..." ; ' +
      `echo "${startSignal}" ; ` +
      `qx compile ${this.compilerArgs.join(" ")} --machine-readable ; ` +
      `echo "${endSignal}" ; ` +
      // postbuild
      (this.postBuild.length ? 'echo "Running postbuild..." ; ' : "") +
      this.postBuild.join(" && ");

    this.process?.kill();
    this.process = childProcess.exec(command, { cwd: this.workDir });
    this.process.stdout?.on("data", lineByLine(onStdout));
    this.process.stderr?.on("data", lineByLine(onStderr));
    this.process.on("exit", () => delete this.process);
  }

  public stop() {
    for (const watcher of this.watchers) watcher.close();
    this.process?.kill();
    delete this.process;
  }
}
