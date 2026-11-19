-- An activity belongs to a role, and may also be labelled with a project (the role-owns model).
-- The old rule was "exactly one owner" (a role or a project); it now only requires at least one, so a
-- project-labelled activity can also carry its project's role. Every existing row satisfies the new rule.
-- The final rule (a role is always present) lands with the NOT NULL step, after every row has a role.
ALTER TABLE "RoleActivity" DROP CONSTRAINT "RoleActivity_exactly_one_owner_check";
ALTER TABLE "RoleActivity" ADD CONSTRAINT "RoleActivity_at_least_one_owner_check"
  CHECK ("experienceId" IS NOT NULL OR "projectId" IS NOT NULL);
