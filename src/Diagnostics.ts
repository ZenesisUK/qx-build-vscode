import * as vscode from "vscode";
import type { BuildProcess, CompilerOutputEvent } from "./BuildProcess";
import fs from "node:fs";
import path from "node:path";
import { strf } from "./util/strf";

// prettier-ignore
const messages = {
  "qx.tool.compiler.class.invalidProperties": "Invalid 'properties' key in class definition",
  "qx.tool.compiler.compiler.missingClassDef": "FATAL Missing class definition - no call to qx.Class.define (or qx.Mixin.define etc)",
  "qx.tool.compiler.compiler.syntaxError": "FATAL Syntax error: %1",
  "qx.tool.compiler.compiler.invalidExtendClause": "FATAL Invalid `extend` clause - expected to find a class name (without quotes or `new`)",
  "qx.tool.compiler.compiler.invalidClassDefinitionEntry": "Unexpected property %2 in %1 definition",
  "qx.tool.compiler.compiler.wrongClassName": "Wrong class name or filename - expected to find at least %1 but only found [%2]",
  "qx.tool.compiler.compiler.membersNotAnObject": "The members property of class %1 is not an object",
  "qx.tool.compiler.application.partRecursive": "Part %1 has recursive dependencies on other parts",
  "qx.tool.compiler.application.duplicatePartNames": "Duplicate parts named '%1'",
  "qx.tool.compiler.application.noBootPart": "Cannot find a boot part",
  "qx.tool.compiler.application.conflictingExactPart": "Conflicting exact match for %1, could be %2 or %3",
  "qx.tool.compiler.application.conflictingBestPart": "Conflicting best match for %1, could be %2 or %3",
  "qx.tool.compiler.application.missingRequiredLibrary": "Cannot find required library %1",
  "qx.tool.compiler.application.missingScriptResource": "Cannot find script resource: %1",
  "qx.tool.compiler.application.missingCssResource": "Cannot find CSS resource: %1",
  "qx.tool.compiler.target.missingAppLibrary": "Cannot find library required to create application for %1",
  "qx.tool.compiler.library.emptyManifest": "Empty Manifest.json in library at %1",
  "qx.tool.compiler.library.cannotCorrectCase": "Unable to correct case for library in %1 because it uses source/resource directories which are outside the library",
  "qx.tool.compiler.library.cannotFindPath": "Cannot find path %2 required by library %1",
  "qx.tool.compiler.build.uglifyParseError": "Parse error in output file %4, line %1 column %2: %3",
  "qx.tool.compiler.webfonts.error": "Error compiling webfont %1, error=%2",
  "qx.tool.compiler.maker.appFatalError": "Cannot write application '%1' because it has fatal errors",
  "qx.tool.compiler.class.blockedMangle": "The mangling of private variable '%1' has been blocked because it is referenced as a string before it is declared",
  "qx.tool.compiler.translate.invalidMessageId": "Cannot interpret message ID %1",
  "qx.tool.compiler.translate.invalidMessageIds": "Cannot interpret message ID %1, %2",
  "qx.tool.compiler.translate.invalidMessageIds3": "Cannot interpret message ID %1, %2, %3",
  "qx.tool.compiler.testForUnresolved": "Unexpected termination when testing for unresolved symbols, node type %1",
  "qx.tool.compiler.testForFunctionParameterType": "Unexpected type of function parameter, node type %1",
  "qx.tool.compiler.defer.unsafe": "Unsafe use of 'defer' method to access external class: %1",
  "qx.tool.compiler.symbol.unresolved": "Unresolved use of symbol %1",
  "qx.tool.compiler.environment.unreachable": "Environment check '%1' may be indeterminable, add to Manifest/provides/environment or use class name prefix",
  "qx.tool.compiler.compiler.requireLiteralArguments": "Wrong class name or filename - expected to find at least %1 but only found [%2]",
  "qx.tool.compiler.target.missingBootJs": "There is no reference to index.js script in the index.html copied from %1",
  "qx.tool.compiler.target.missingPreBootJs": "There is no reference to ${preBootJs} in the index.html copied from %1",
  "qx.tool.compiler.compiler.mixinQxObjectImpl": "%1: Mixins should not use `_createQxObjectImpl`, consider using top-level objects instead",
  "qx.tool.compiler.maker.appNotHeadless": "Compiling application '%1' but the target supports non-headless output, you may find unwanted dependencies are loaded during startup",
  "qx.tool.compiler.webfonts.deprecated": "Manifest uses deprecated provides.webfonts, consider switching to provides.font in %1",
  "qx.tool.compiler.fonts.unresolved": "Cannot find font with name %1",
  "qx.tool.compiler.webfonts.noResources": "Assets required for webfont %1 are not available in application %2, consider using @asset to include %3",
};

type LogItem<T extends "class" | "project"> = T extends "class"
  ? {
      kind: "class";
      classname: string;
      start: {
        line: number;
        column: number;
      };
      end: {
        line: number;
        column: number;
      };
      level: string;
      message: string;
    }
  : T extends "project"
  ? {
      kind: "project";
      messageId: string;
      args: string[];
    }
  : never;

/**
 * In order, groups are:
 * - classname
 * - position start
 * - position end
 * - level
 * - message
 */
export class Diagnostics {
  constructor(
    private context: vscode.ExtensionContext,
    private channel: vscode.OutputChannel,
    private workspace: string,
    private buildProcess: BuildProcess,
  ) {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection(`qooxdoo:${this.prefix}`);
    this.context.subscriptions.push(this.diagnosticCollection);
    this.buildProcess.on("data", event => this.hit(event));
    this.buildProcess.on("build", () => this.diagnosticCollection.clear());
  }

  private get prefix() {
    return `${this.workspace}:${this.buildProcess.name}`;
  }

  private log(message: string) {
    this.channel.appendLine(`[${this.prefix}]: ${message}`);
  }

  private diagnosticCollection: vscode.DiagnosticCollection;

  private parseLogItem(data: string): LogItem<"class" | "project"> | null {
    data = data.slice(2);
    let failureMessage = "";
    try {
      const messageId = data.split(":")[0];
      const args = JSON.parse(data.slice(messageId.length + 1));
      return { kind: "project", messageId, args };
    } catch (cause) {
      if (!(cause instanceof Error)) throw cause;
      failureMessage += `\n\tCould not interpret as a project issue: ${cause.message}`;
    }
    try {
      const SEP = "\u{FFFF}";
      const [classname, positionStart, positionEnd, level, ...message] = data.replace(/[:\s]+/gi, SEP).split(SEP);
      if (!classname) throw new Error(`Failed to parse class issue: ${data}`);
      const parsedPositionStart = JSON.parse(positionStart);
      const parsedPositionEnd = JSON.parse(positionEnd);
      return {
        kind: "class",
        classname,
        start: {
          line: parsedPositionStart[0],
          column: parsedPositionStart[1],
        },
        end: {
          line: parsedPositionEnd[0],
          column: parsedPositionEnd[1],
        },
        level,
        message: message.join(" "),
      };
    } catch (cause) {
      if (!(cause instanceof Error)) throw cause;
      failureMessage += `\n\tCould not interpret as a class issue: ${cause.message}`;
    }
    this.log(`Failed to parse log item: '${data}'${failureMessage}\n`);
    return null;
  }

  private decodeLevel(level?: string, source?: "stdout" | "stderr") {
    return level === "error"
      ? vscode.DiagnosticSeverity.Error
      : level === "warning"
      ? vscode.DiagnosticSeverity.Warning
      : level === "trace"
      ? vscode.DiagnosticSeverity.Information
      : source === "stdout"
      ? vscode.DiagnosticSeverity.Information
      : source === "stderr"
      ? vscode.DiagnosticSeverity.Error
      : vscode.DiagnosticSeverity.Hint;
  }

  private findFilesForClass(classname: string) {
    const classpath = path.join(...classname.split(".")) + ".js";
    const files = [];
    for (const sourcePath of this.buildProcess.sourcePaths) {
      const basePath = path.resolve(this.workspace, sourcePath);
      files.push(
        ...fs
          .readdirSync(basePath, { recursive: true, encoding: "utf-8" })
          .filter(file => !file.split(path.sep).includes("transpiled"))
          .filter(file => file.endsWith(classpath))
          .map(file => path.resolve(basePath, file))
          .filter(file => fs.existsSync(file))
          .map(file => vscode.Uri.parse(file)),
      );
    }
    return files;
  }

  private appendIssue(key: vscode.Uri, ...diagnostics: vscode.Diagnostic[]) {
    const existing = this.diagnosticCollection.get(key) ?? [];
    this.diagnosticCollection.set(key, [...existing, ...diagnostics]);
    this.log(`Appended ${diagnostics.length} diagnostics to ${key.fsPath}`);
  }

  private projectIssue(data: LogItem<"project">, source: "stdout" | "stderr") {
    if (!(data.messageId in messages)) return;
    const message = strf(messages[data.messageId as keyof typeof messages], ...data.args);
    this.appendIssue(
      vscode.Uri.parse(this.workspace),
      new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 0),
        `${message} (${data.messageId})`,
        this.decodeLevel(undefined, source),
      ),
    );
  }

  private classIssue(data: LogItem<"class">, source: "stdout" | "stderr") {
    const files = this.findFilesForClass(data.classname);
    if (files.length > 1) data.message += `\nmultiple files found:${files.map(f => `\n- ${f}`).join("")}`;
    const diagnostic = [
      new vscode.Range(data.start.line - 1, data.start.column, data.end.line - 1, data.end.column),
      data.message,
      this.decodeLevel(data.level, source),
    ] as const;
    if (files.length === 0)
      return this.appendIssue(vscode.Uri.parse(this.workspace), new vscode.Diagnostic(...diagnostic));
    for (const file of files) this.appendIssue(file, new vscode.Diagnostic(...diagnostic));
  }

  public hit({ data, source }: CompilerOutputEvent) {
    if (!data.startsWith("##")) return;
    const logItem = this.parseLogItem(data);
    if (!logItem) return;
    if (logItem.kind === "project") this.projectIssue(logItem, source);
    else if (logItem.kind === "class") this.classIssue(logItem, source);
  }
}
