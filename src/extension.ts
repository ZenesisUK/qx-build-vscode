import * as vscode from "vscode";
import fs from "fs";
import path from "path";
import { BuildProcess } from "./BuildProcess.js";

class Extension {
  public constructor(private context: vscode.ExtensionContext) {
    this.channel = vscode.window.createOutputChannel("QX Build");
  }

  #qxProjects!: string[];
  public get qxProjects() {
    if (!this.#qxProjects) {
      this.#qxProjects = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
      let unchecked = true;
      while (unchecked) {
        unchecked = false;
        for (const potentialProject of this.#qxProjects) {
          if (!fs.existsSync(path.join(potentialProject, "compile.json"))) {
            this.#qxProjects.splice(this.#qxProjects.indexOf(potentialProject), 1);
            const dirs = fs
              .readdirSync(potentialProject, { withFileTypes: true })
              .filter(dirent => dirent.isDirectory())
              .map(dirent => path.join(potentialProject, dirent.name));
            if (dirs.length) {
              this.#qxProjects.push(...dirs);
              unchecked = true;
            }
          }
        }
      }
    }
    return this.#qxProjects;
  }

  private channel: vscode.OutputChannel;
  private workspaces: string[] = [];
  private registerQxBuilds() {
    this.channel.appendLine("Registering qx.build files...");
    this.workspaces = this.qxProjects.filter(folder => fs.existsSync(BuildProcess.qxBuildFileFor(folder)));
    this.channel.appendLine("Registered qx.build file in each of the following directories:");
    for (const workspace of this.workspaces) this.channel.appendLine(`- ${workspace}`);
  }

  private buildProcesses: Map<string, Map<string, BuildProcess>> = new Map();
  private createBuildProcesses() {
    this.channel.appendLine("Creating build processes...");
    for (const workspace of this.workspaces) {
      const workspaceKey = BuildProcess.qxBuildFileFor(workspace);
      const buildProcesses = BuildProcess.createFor(this.context, workspace, this.buildProcesses.get(workspaceKey));
      if (!buildProcesses) continue;
      this.buildProcesses.set(workspaceKey, buildProcesses);
    }
    for (const key of this.buildProcesses.keys()) {
      if (!this.qxProjects.some(dir => BuildProcess.qxBuildFileFor(dir) === key)) {
        const buildProcesses = this.buildProcesses.get(key)!;
        buildProcesses.forEach(buildProcess => buildProcess.stop());
        this.buildProcesses.delete(key);
      }
    }
    this.channel.appendLine("Build processes created!");
  }

  private vscodeFileSystemWatchers: Map<string, vscode.FileSystemWatcher> = new Map();
  private initializeBuilders() {
    this.channel.appendLine("Initializing builders...");
    this.registerQxBuilds();
    this.createBuildProcesses();
    for (const file of this.qxProjects) {
      const filepath = BuildProcess.qxBuildFileFor(file);
      if (this.vscodeFileSystemWatchers.has(filepath)) continue;
      const watcher = vscode.workspace.createFileSystemWatcher(filepath);
      this.channel.appendLine(`Created new watcher for ${filepath}`);
      this.vscodeFileSystemWatchers.set(filepath, watcher);
      const updater = () => {
        this.channel.appendLine(`Updating builders because of changes to ${filepath}`);
        this.initializeBuilders();
      };
      watcher.onDidChange(updater);
      watcher.onDidCreate(updater);
      watcher.onDidDelete(updater);
    }
    for (const key of this.vscodeFileSystemWatchers.keys()) {
      if (!this.qxProjects.some(dir => BuildProcess.qxBuildFileFor(dir) === key)) {
        this.vscodeFileSystemWatchers.get(key)!.dispose();
        this.vscodeFileSystemWatchers.delete(key);
      }
    }
    this.channel.appendLine("Builders initialized!");
  }

  private async userSelectBuilder(allowSelectAll?: false): Promise<BuildProcess>;
  private async userSelectBuilder(allowSelectAll: boolean): Promise<BuildProcess | string>;
  private async userSelectBuilder(allowSelectAll = false) {
    const projects = [...this.buildProcesses.keys(), ...(allowSelectAll ? ["all"] : [])];
    let selectedProject;
    if (projects.length === 0) {
      await vscode.window.showErrorMessage("No Qooxdoo projects found");
      return;
    } else selectedProject = await vscode.window.showQuickPick(projects);
    if (!selectedProject) return;
    if (selectedProject === "all") return selectedProject;

    const buildTasks = [...this.buildProcesses.get(selectedProject!)!.keys(), ...(allowSelectAll ? ["all"] : [])];
    let selectedTask;
    if (buildTasks.length === 0) {
      await vscode.window.showErrorMessage("No build tasks found");
      return;
    } else selectedTask = await vscode.window.showQuickPick(buildTasks);
    if (!selectedTask) return;
    if (selectedTask === "all") return `${selectedProject}.${selectedTask}`;

    return this.buildProcesses.get(selectedProject)!.get(selectedTask)!;
  }

  private async runBuilder(watch: boolean) {
    const build = async (process: BuildProcess) => {
      if (watch) process.start();
      else process.debounceBuild();
    };
    const buildProcess = await this.userSelectBuilder(watch);
    if (!buildProcess) return;
    if (typeof buildProcess !== "string") await build(buildProcess);
    else if (buildProcess === "all") {
      for (const processes of this.buildProcesses.values()) for (const proc of processes.values()) build(proc);
    } else if (buildProcess.endsWith(".all")) {
      for (const process of this.buildProcesses.get(buildProcess.split(".")[0])!.values()) await build(process);
    }
  }

  private async stopBuilder() {
    const buildProcess = await this.userSelectBuilder(true);
    if (!buildProcess) return;
    if (typeof buildProcess !== "string") buildProcess.stop();
    else if (buildProcess === "all") {
      for (const processes of this.buildProcesses.values()) processes.forEach(process => process.stop());
    } else if (buildProcess.endsWith(".all")) {
      for (const process of this.buildProcesses.get(buildProcess.split(".")[0])!.values()) process.stop();
    }
  }

  private async showData(data: string) {
    vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument({
        content: data,
        language: "json",
      }),
    );
  }

  private async sampleQxBuild() {
    await this.showData(
      JSON.stringify(
        {
          $schema:
            "https://raw.githubusercontent.com/zenesisUK/qx-build-vscode/refs/heads/main/src/qx.build.schema.json",
          autostart: "My Qooxdoo App",
          builders: [
            {
              name: "My Qooxdoo App",
              workDir: ".",
              compilerArgs: ["-T"],
              preBuild: ['echo "I\'m a preBuild command"'],
              postBuild: ['echo "I\'m a postBuild command"'],
              sourcePaths: ["compile.json#libraries"],
            },
          ],
        },
        null,
        2,
      ),
    );
  }

  private async inspectConfig() {
    const buildProcess = await this.userSelectBuilder();
    if (!buildProcess) return;
    await this.showData(JSON.stringify(buildProcess.toJson(), null, 2));
  }

  public activate() {
    this.channel.appendLine("qx-build-vscode activating...");
    vscode.workspace.onDidChangeWorkspaceFolders(() => this.initializeBuilders());
    this.initializeBuilders();
    this.context.subscriptions.push(
      vscode.commands.registerCommand("qx-build-vscode.buildOnce", () => this.runBuilder(false)),
    );
    this.context.subscriptions.push(
      vscode.commands.registerCommand("qx-build-vscode.buildWatch", () => this.runBuilder(true)),
    );
    this.context.subscriptions.push(
      vscode.commands.registerCommand("qx-build-vscode.stopBuilder", () => this.stopBuilder()),
    );
    this.context.subscriptions.push(
      vscode.commands.registerCommand("qx-build-vscode.sampleQxBuild", () => this.sampleQxBuild()),
    );
    this.context.subscriptions.push(
      vscode.commands.registerCommand("qx-build-vscode.inspectConfig", () => this.inspectConfig()),
    );
    this.channel.appendLine("qx-build-vscode activated!");
  }

  public async deactivate() {}
}

let extension: Extension;
export const activate = async (context: vscode.ExtensionContext) => {
  try {
    extension = new Extension(context);
    await extension.activate();
  } catch (e) {
    if (!(e instanceof Error)) throw e;
    vscode.window.showErrorMessage(`Error activating qx-build-vscode: ${e.message}, ${e.stack}`);
  }
};
export const deactivate = async () => await extension.deactivate();
