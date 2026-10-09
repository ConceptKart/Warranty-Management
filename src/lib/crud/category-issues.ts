import { prisma } from "@/lib/db";
import {
  asNumber,
  asString,
  serializeRow,
  serializeRows,
  sqlNullableString,
} from "@/lib/crud/http";

export async function listCategoryIssues(
  page: number,
  limit: number,
  offset: number,
) {
  const [countRows, rows] = await Promise.all([
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*) AS c FROM category_issues`,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT id, category, issue_name, troubleshooting_steps, created_at, updated_at
      FROM category_issues
      ORDER BY id DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
  ]);
  return {
    totalRecords: Number(countRows[0]?.c ?? 0),
    data: serializeRows(rows),
    page,
    limit,
  };
}

export async function getCategoryIssueById(id: number) {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT id, category, issue_name, troubleshooting_steps, created_at, updated_at
    FROM category_issues
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows[0] ? serializeRow(rows[0]) : null;
}

export async function createCategoryIssue(body: Record<string, unknown>) {
  const category = asString(body.category)?.trim();
  const issueName = asString(body.issue_name)?.trim();
  const steps = asString(body.troubleshooting_steps)?.trim();
  if (!category || !issueName || !steps) {
    return {
      error:
        "All fields (category, issue_name, troubleshooting_steps) are required.",
    };
  }

  await prisma.$executeRaw`
    INSERT INTO category_issues (category, issue_name, troubleshooting_steps, created_at)
    VALUES (${category}, ${issueName}, ${steps}, NOW())
  `;

  const created = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM category_issues
    WHERE category = ${category} AND issue_name = ${issueName}
    ORDER BY id DESC LIMIT 1
  `;
  const id = created[0]?.id;
  return { data: id ? await getCategoryIssueById(id) : null };
}

export async function updateCategoryIssue(
  id: number | null,
  body: Record<string, unknown>,
) {
  const issueId = id ?? asNumber(body.id);
  if (!issueId) return { error: "id is required in URL (?id=X) or body." };
  const existing = await getCategoryIssueById(issueId);
  if (!existing) return { error: "Category issue not found." };

  await prisma.$executeRaw`
    UPDATE category_issues SET
      category = COALESCE(${sqlNullableString(body.category)}, category),
      issue_name = COALESCE(${sqlNullableString(body.issue_name)}, issue_name),
      troubleshooting_steps = COALESCE(${sqlNullableString(body.troubleshooting_steps)}, troubleshooting_steps),
      updated_at = NOW()
    WHERE id = ${issueId}
  `;
  return { data: await getCategoryIssueById(issueId) };
}

export async function deleteCategoryIssue(id: number) {
  if (!id) return { error: "id is required." };
  const existing = await getCategoryIssueById(id);
  if (!existing) return { error: "Category issue not found." };
  await prisma.$executeRaw`DELETE FROM category_issues WHERE id = ${id}`;
  return { data: { deleted: true, id } };
}
