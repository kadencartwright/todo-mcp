#!/usr/bin/env node
/* eslint-disable no-console */

import Database from "better-sqlite3";
import { z } from "zod";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// ---------- SQLite setup ----------
const db = new Database("todos.sqlite");

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_todos_createdAt ON todos(createdAt);
`);

const insertTodoStmt = db.prepare(`
  INSERT INTO todos (name, description, createdAt, updatedAt)
  VALUES (@name, @description, @createdAt, @updatedAt)
`);

const getTodoByIdStmt = db.prepare(`
  SELECT id, name, description, createdAt, updatedAt
  FROM todos
  WHERE id = ?
`);

const listTodosStmt = db.prepare(`
  SELECT id, name, description, createdAt, updatedAt
  FROM todos
  ORDER BY datetime(createdAt) DESC
  LIMIT ?
`);

// ---------- MCP server ----------
const server = new Server(
  {
    name: "sqlite-todo-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool: create_todo
server.setTool(
  "create_todo",
  {
    title: "Create Todo",
    description: "Create a todo with a name and description.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1 },
        description: { type: "string", minLength: 1 },
      },
      required: ["name", "description"],
      additionalProperties: false,
    },
  },
  async (args) => {
    const schema = z.object({
      name: z.string().min(1),
      description: z.string().min(1),
    });

    const { name, description } = schema.parse(args);

    const now = new Date().toISOString();
    const info = insertTodoStmt.run({
      name,
      description,
      createdAt: now,
      updatedAt: now,
    });

    const todo = getTodoByIdStmt.get(info.lastInsertRowid);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(todo, null, 2),
        },
      ],
    };
  }
);

// Tool: get_todo
server.setTool(
  "get_todo",
  {
    title: "Get Todo",
    description: "Fetch a todo by id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  async (args) => {
    const schema = z.object({
      id: z.number().int().positive(),
    });

    const { id } = schema.parse(args);
    const todo = getTodoByIdStmt.get(id);

    if (!todo) {
      return {
        content: [
          {
            type: "text",
            text: `Todo ${id} not found.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(todo, null, 2),
        },
      ],
    };
  }
);

// Tool: list_todos
server.setTool(
  "list_todos",
  {
    title: "List Todos",
    description: "List recent todos (default limit 50).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", minimum: 1, maximum: 500 },
      },
      required: [],
      additionalProperties: false,
    },
  },
  async (args) => {
    const schema = z
      .object({
        limit: z.number().int().min(1).max(500).optional(),
      })
      .default({});

    const { limit } = schema.parse(args ?? {});
    const rows = listTodosStmt.all(limit ?? 50);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(rows, null, 2),
        },
      ],
    };
  }
);

// ---------- Start over stdio ----------
const transport = new StdioServerTransport();
await server.connect(transport);
