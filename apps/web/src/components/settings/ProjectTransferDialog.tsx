import { useRef, useState } from "react";
import { copyProjectToEnvironment } from "@t3tools/client-runtime/state/projects";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectTransferMode } from "@t3tools/contracts";
import type { SidebarProjectGroupMember } from "../../sidebarProjectGrouping";
import { useEnvironments } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { toastManager } from "../ui/toast";

export function ProjectTransferDialog({
  sources,
  destinationId,
}: {
  sources: readonly SidebarProjectGroupMember[];
  destinationId?: EnvironmentId | undefined;
}) {
  const { environments } = useEnvironments();
  const [open, setOpen] = useState(false);
  const [sourceKey, setSourceKey] = useState(sources[0]?.physicalProjectKey ?? "");
  const [pickedTarget, setTarget] = useState<EnvironmentId | "">(destinationId ?? "");
  const target = destinationId ?? pickedTarget;
  const [destinationPath, setDestinationPath] = useState("");
  const [mode, setMode] = useState<ProjectTransferMode>(
    sources[0]?.repositoryIdentity ? "clone" : "copy",
  );
  const [includeIgnored, setIncludeIgnored] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const transfer = useAtomCommand(projectEnvironment.transfer, "copy project");
  const source = sources.find((item) => item.physicalProjectKey === sourceKey) ?? sources[0];
  const busy = progress !== null;
  const supported = (id: EnvironmentId) => {
    const environment = environments.find((item) => item.environmentId === id);
    return (
      environment?.connection.phase === "connected" &&
      environment.serverConfig?.environment.capabilities.projectTransfer === true
    );
  };
  const ready =
    source &&
    target &&
    source.environmentId !== target &&
    supported(source.environmentId) &&
    supported(target);
  const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

  async function start() {
    if (!source || !target || !ready || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setError(null);
    try {
      const result = await copyProjectToEnvironment({
        sourceEnvironmentId: source.environmentId,
        destinationEnvironmentId: target,
        projectId: source.id,
        destinationPath: destinationPath.trim(),
        mode,
        includeIgnored,
        signal: abort.signal,
        onProgress: setProgress,
        request: async (environmentId, input) => {
          const result = await transfer({ environmentId, input });
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          return result.value;
        },
      });
      toastManager.add({ type: "success", title: "Project copied", description: result.cwd });
      setOpen(false);
    } catch (cause) {
      setError(
        abort.signal.aborted
          ? "Copy cancelled."
          : cause instanceof Error
            ? cause.message
            : String(cause),
      );
    } finally {
      controller.current = null;
      setProgress(null);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {destinationId ? "Copy from another machine" : "Copy to another machine"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogPopup showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Copy project to another machine</DialogTitle>
            <DialogDescription>
              Create a separate checkout with this project's settings and actions. The source stays
              intact.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <label className="block space-y-1 text-sm">
              Source checkout
              <select
                className={selectClass}
                disabled={busy}
                value={source?.physicalProjectKey ?? ""}
                onChange={(event) => setSourceKey(event.target.value)}
              >
                {sources.map((item) => (
                  <option key={item.physicalProjectKey} value={item.physicalProjectKey}>
                    {item.environmentLabel ?? "Machine"} · {item.workspaceRoot}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              Destination machine
              <select
                className={selectClass}
                disabled={busy || destinationId !== undefined}
                value={target}
                onChange={(event) => setTarget(event.target.value as EnvironmentId)}
              >
                <option value="">Choose a machine</option>
                {environments
                  .filter((item) => item.environmentId !== source?.environmentId)
                  .map((item) => (
                    <option key={item.environmentId} value={item.environmentId}>
                      {item.label}
                    </option>
                  ))}
              </select>
            </label>
            {target && !ready && (
              <p className="text-sm text-muted-foreground">
                Both machines must be connected and running a build that supports project copying.
              </p>
            )}
            <label className="block space-y-1 text-sm">
              New folder on the destination
              <Input
                value={destinationPath}
                disabled={busy}
                placeholder="~/code/my-project"
                onChange={(event) => setDestinationPath(event.target.value)}
              />
            </label>
            <fieldset disabled={busy} className="space-y-3 text-sm">
              <legend className="mb-2 font-medium">Files to copy</legend>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="project-transfer-mode"
                  checked={mode === "clone"}
                  onChange={() => setMode("clone")}
                  className="mt-1"
                />
                <span>
                  Fresh checkout
                  <span className="block text-muted-foreground">
                    Clone the repository's default branch. Local changes and ignored files stay on
                    the source.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="project-transfer-mode"
                  checked={mode === "copy"}
                  onChange={() => setMode("copy")}
                  className="mt-1"
                />
                <span>
                  One-time copy
                  <span className="block text-muted-foreground">
                    Copy the current files, Git history and uncommitted work. Pause edits while
                    preparing the snapshot.
                  </span>
                </span>
              </label>
              {mode === "copy" && (
                <label className="flex items-start gap-2 pl-5">
                  <input
                    type="checkbox"
                    checked={includeIgnored}
                    onChange={(event) => setIncludeIgnored(event.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    Include ignored files
                    <span className="block text-muted-foreground">
                      Includes .env files and installed dependencies, which may need reinstalling on
                      a different OS.
                    </span>
                  </span>
                </label>
              )}
            </fieldset>
            <p className="text-xs text-muted-foreground">
              Conversations and machine-level provider credentials stay on the source. Existing
              folders are never overwritten. One-time copies support up to 10 GB.
            </p>
            {progress && (
              <p role="status" className="text-sm">
                {progress}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => (busy ? controller.current?.abort() : setOpen(false))}
            >
              {busy ? "Cancel copy" : "Cancel"}
            </Button>
            <Button
              disabled={busy || !ready || !destinationPath.trim()}
              onClick={() => void start()}
            >
              Copy project
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
