/// <reference types="node" />
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ImportError, parseProject, type Project } from "@gap/process-model";
import { z } from "zod";
import { HttpError, sendJson, sendNoContent, type Ctx, type Route } from "../http";
import { isId } from "../names";
import { idParam, notFound, parseBody, userPath } from "./util";

interface ProjectFile {
  id: string;
  revision: number;
  updatedAt: string;
  project: Project;
}

const createSchema = z.object({ project: z.unknown() });
const updateSchema = z.object({
  project: z.unknown(),
  baseRevision: z.number({ error: "baseRevision must be a number." }).int("baseRevision must be a whole number.").min(1, "baseRevision must be 1 or more."),
});

/** The module key an account needs to keep TRD documents inside its projects. */
export const TRD_MODULE = "trd";

/**
 * A TRD lives inside the project file, so the server-side check for the TRD module is made where the project is saved: a project
 * that holds TRD documents is refused for an account without the module (the menu being hidden in the web app is only a
 * convenience). A project with no TRD documents is never affected.
 */
function requireTrdModuleForProject(ctx: Ctx, project: Project): void {
  if (project.trd.documents.length > 0 && !ctx.user.plan.modules.includes(TRD_MODULE)) {
    throw new HttpError(403, "module-not-included", "This account does not include the TRD module, and the project holds a TRD.");
  }
}

/** Runs the shared project check; its message names what is wrong with the file. */
function checkProject(input: unknown): Project {
  try {
    return parseProject(input);
  } catch (err) {
    if (err instanceof ImportError) {
      const issues = err.issues.slice(0, 5).join("; ");
      throw new HttpError(400, "invalid-project", issues ? `${err.message}: ${issues}` : err.message);
    }
    throw new HttpError(400, "invalid-project", "The project could not be read.");
  }
}

export const projectRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/projects",
    auth: true,
    storage: true,
    async handler(ctx) {
      const { store } = ctx.app;
      const folder = userPath(ctx, "projects");
      const items: { id: string; title: string; updatedAt: string; revision: number; schemaVersion: string }[] = [];
      for (const name of await store.list(folder)) {
        if (!name.endsWith(".json") || !isId(name.slice(0, -5))) continue;
        const file = await store.readJson<ProjectFile | null>(join(folder, name), null).catch(() => null);
        if (!file) continue;
        items.push({
          id: file.id,
          title: file.project.meta.title,
          updatedAt: file.updatedAt,
          revision: file.revision,
          schemaVersion: file.project.schemaVersion,
        });
      }
      items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      sendJson(ctx.res, 200, { projects: items });
    },
  },

  {
    method: "POST",
    path: "/api/projects",
    auth: true,
    storage: true,
    async handler(ctx) {
      const body = parseBody(createSchema, await ctx.json());
      const project = checkProject(body.project);
      requireTrdModuleForProject(ctx, project);
      const id = randomUUID();
      const file: ProjectFile = { id, revision: 1, updatedAt: new Date().toISOString(), project };
      await ctx.app.store.writeJson(userPath(ctx, "projects", `${id}.json`), file);
      sendJson(ctx.res, 201, { id, revision: file.revision, updatedAt: file.updatedAt });
    },
  },

  {
    method: "GET",
    path: "/api/projects/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      const id = idParam(ctx);
      const file = await ctx.app.store.readJson<ProjectFile | null>(userPath(ctx, "projects", `${id}.json`), null);
      if (!file) throw notFound("project");
      sendJson(ctx.res, 200, file);
    },
  },

  {
    method: "PUT",
    path: "/api/projects/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      const id = idParam(ctx);
      const body = parseBody(updateSchema, await ctx.json());
      const project = checkProject(body.project);
      requireTrdModuleForProject(ctx, project);
      let saved: ProjectFile | undefined;
      // Read, compare and write as one step, so two computers cannot both win with the same base revision.
      await ctx.app.store.update<ProjectFile | null>(userPath(ctx, "projects", `${id}.json`), null, (current) => {
        if (!current) throw notFound("project");
        if (current.revision !== body.baseRevision) {
          throw new HttpError(409, "conflict", "This project was changed somewhere else.", {
            revision: current.revision,
            updatedAt: current.updatedAt,
          });
        }
        saved = { id, revision: current.revision + 1, updatedAt: new Date().toISOString(), project };
        return saved;
      });
      sendJson(ctx.res, 200, { revision: saved?.revision, updatedAt: saved?.updatedAt });
    },
  },

  {
    method: "DELETE",
    path: "/api/projects/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      const id = idParam(ctx);
      const file = userPath(ctx, "projects", `${id}.json`);
      const { store } = ctx.app;
      await store.withLock(file, async () => {
        if (!(await store.exists(file))) throw notFound("project");
        await store.toTrash(ctx.user.id, "projects", file, `${id}.json`);
      });
      await store.audit("project-delete", { userId: ctx.user.id, projectId: id, ip: ctx.ip });
      sendNoContent(ctx.res);
    },
  },
];
