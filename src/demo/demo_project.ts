export interface DemoFile {
  path: string;
  language: string;
  content: string;
}

export interface TutorMove {
  filePath: string;
  line: number;
  column: number;
  speech: string;
  action: 'jump' | 'point' | 'think';
  waitMs?: number;
}

export const demoFiles: DemoFile[] = [
  {
    path: 'src/app.ts',
    language: 'typescript',
    content: `import express from "express";
import { requireAdmin } from "./require_admin";
import { adminProductRouter } from "./admin_product_routes";

const app = express();

app.use(express.json());

app.use(
  "/api/admin",
  requireAdmin,
);

app.use(
  "/api/admin/products",
  adminProductRouter,
);

app.listen(3000, () => {
  console.log("Shopping API started");
});
`,
  },
  {
    path: 'src/require_admin.ts',
    language: 'typescript',
    content: `import type { NextFunction, Request, Response } from "express";

export async function requireAdmin(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    response.status(401).json({ message: "Unauthorized" });
    return;
  }

  const token = authorization.slice("Bearer ".length);

  if (token.length === 0) {
    response.status(401).json({ message: "Missing token" });
    return;
  }

  response.locals.adminToken = token;
  next();
}
`,
  },
  {
    path: 'src/admin_product_routes.ts',
    language: 'typescript',
    content: `import { Router } from "express";

export const adminProductRouter = Router();

adminProductRouter.post("/", async (request, response) => {
  const title = String(request.body.title ?? "").trim();
  const price = Number(request.body.price);

  if (!title || !Number.isFinite(price)) {
    response.status(400).json({ message: "Invalid product" });
    return;
  }

  response.status(201).json({
    id: crypto.randomUUID(),
    title,
    price,
  });
});
`,
  },
];

export const demoMoves: TutorMove[] = [
  {
    filePath: 'src/app.ts',
    line: 9,
    column: 1,
    action: 'jump',
    speech: '先看这里。所有 /api/admin 请求都会先经过 requireAdmin。',
  },
  {
    filePath: 'src/app.ts',
    line: 11,
    column: 3,
    action: 'point',
    speech: '真正负责权限判断的是 requireAdmin。接下来我跳进它的文件。',
  },
  {
    filePath: 'src/require_admin.ts',
    line: 8,
    column: 3,
    action: 'jump',
    speech: '这里先读取 Authorization 请求头。',
  },
  {
    filePath: 'src/require_admin.ts',
    line: 10,
    column: 3,
    action: 'point',
    speech: '如果不是 Bearer Token，请求就在这里被挡住。',
  },
  {
    filePath: 'src/require_admin.ts',
    line: 23,
    column: 3,
    action: 'think',
    speech: '验证完成后调用 next，让请求继续走后面的路由。',
  },
  {
    filePath: 'src/admin_product_routes.ts',
    line: 5,
    column: 1,
    action: 'jump',
    speech: '于是请求最终来到商品创建路由。角色现在已经可以跨文件移动了。',
  },
];
