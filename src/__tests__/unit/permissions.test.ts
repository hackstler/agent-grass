import { describe, it, expect } from "vitest";
import {
  hasPermission,
  getPermissionScope,
  getPermissionSet,
  ROLE_PERMISSIONS,
  type Permission,
  type Role,
} from "../../domain/permissions.js";

describe("Permission System", () => {
  // ── hasPermission ──────────────────────────────────────────────────────────

  describe("hasPermission", () => {
    it("user has edit_own_profile", () => {
      expect(hasPermission("user", "edit_own_profile")).toBe(true);
    });

    it("user has use_chat", () => {
      expect(hasPermission("user", "use_chat")).toBe(true);
    });

    it("user has use_whatsapp_personal", () => {
      expect(hasPermission("user", "use_whatsapp_personal")).toBe(true);
    });

    it("user has view_own_org", () => {
      expect(hasPermission("user", "view_own_org")).toBe(true);
    });

    it("user does NOT have view_org_users", () => {
      expect(hasPermission("user", "view_org_users")).toBe(false);
    });

    it("user does NOT have edit_org_users", () => {
      expect(hasPermission("user", "edit_org_users")).toBe(false);
    });

    it("user does NOT have create_org_users", () => {
      expect(hasPermission("user", "create_org_users")).toBe(false);
    });

    it("user does NOT have view_knowledge", () => {
      expect(hasPermission("user", "view_knowledge")).toBe(false);
    });

    it("user does NOT have manage_knowledge", () => {
      expect(hasPermission("user", "manage_knowledge")).toBe(false);
    });

    it("user does NOT have view_whatsapp_mgmt", () => {
      expect(hasPermission("user", "view_whatsapp_mgmt")).toBe(false);
    });

    it("user does NOT have create_org", () => {
      expect(hasPermission("user", "create_org")).toBe(false);
    });

    it("admin has view_org_users", () => {
      expect(hasPermission("admin", "view_org_users")).toBe(true);
    });

    it("admin has edit_org_users", () => {
      expect(hasPermission("admin", "edit_org_users")).toBe(true);
    });

    it("admin has manage_knowledge", () => {
      expect(hasPermission("admin", "manage_knowledge")).toBe(true);
    });

    it("admin has manage_catalogs", () => {
      expect(hasPermission("admin", "manage_catalogs")).toBe(true);
    });

    it("admin does NOT have view_whatsapp_mgmt", () => {
      expect(hasPermission("admin", "view_whatsapp_mgmt")).toBe(false);
    });

    it("admin does NOT have create_org", () => {
      expect(hasPermission("admin", "create_org")).toBe(false);
    });

    it("admin does NOT have delete_org", () => {
      expect(hasPermission("admin", "delete_org")).toBe(false);
    });

    it("admin does NOT have view_all_orgs", () => {
      expect(hasPermission("admin", "view_all_orgs")).toBe(false);
    });

    it("admin does NOT have revoke_whatsapp", () => {
      expect(hasPermission("admin", "revoke_whatsapp")).toBe(false);
    });

    it("super_admin has every permission", () => {
      const allPermissions: Permission[] = [
        "edit_own_profile", "view_org_users", "edit_org_users",
        "create_org_users", "delete_org_users", "view_own_org",
        "edit_own_org", "view_all_orgs", "create_org", "delete_org",
        "view_knowledge", "manage_knowledge", "view_whatsapp_mgmt",
        "revoke_whatsapp", "manage_catalogs", "use_chat",
        "use_whatsapp_personal",
      ];
      for (const p of allPermissions) {
        expect(hasPermission("super_admin", p)).toBe(true);
      }
    });
  });

  // ── getPermissionScope ─────────────────────────────────────────────────────

  describe("getPermissionScope", () => {
    it("user edit_own_profile returns 'own'", () => {
      expect(getPermissionScope("user", "edit_own_profile")).toBe("own");
    });

    it("user use_chat returns 'own_org'", () => {
      expect(getPermissionScope("user", "use_chat")).toBe("own_org");
    });

    it("user view_org_users returns null (no permission)", () => {
      expect(getPermissionScope("user", "view_org_users")).toBeNull();
    });

    it("admin view_org_users returns 'own_org'", () => {
      expect(getPermissionScope("admin", "view_org_users")).toBe("own_org");
    });

    it("admin edit_own_org returns 'own'", () => {
      expect(getPermissionScope("admin", "edit_own_org")).toBe("own");
    });

    it("admin view_whatsapp_mgmt returns null (no permission)", () => {
      expect(getPermissionScope("admin", "view_whatsapp_mgmt")).toBeNull();
    });

    it("super_admin view_org_users returns 'all'", () => {
      expect(getPermissionScope("super_admin", "view_org_users")).toBe("all");
    });

    it("super_admin create_org returns 'all'", () => {
      expect(getPermissionScope("super_admin", "create_org")).toBe("all");
    });

    it("super_admin view_whatsapp_mgmt returns 'all'", () => {
      expect(getPermissionScope("super_admin", "view_whatsapp_mgmt")).toBe("all");
    });
  });

  // ── getPermissionSet ───────────────────────────────────────────────────────

  describe("getPermissionSet", () => {
    it("user has exactly 5 permissions", () => {
      const set = getPermissionSet("user");
      expect(set.size).toBe(5);
      expect(set.has("edit_own_profile")).toBe(true);
      expect(set.has("view_own_org")).toBe(true);
      expect(set.has("view_quotes")).toBe(true);
      expect(set.has("use_chat")).toBe(true);
      expect(set.has("use_whatsapp_personal")).toBe(true);
    });

    it("admin has 13 permissions (no whatsapp mgmt, no org CRUD, no view_all_orgs)", () => {
      const set = getPermissionSet("admin");
      expect(set.size).toBe(13);
      expect(set.has("view_org_users")).toBe(true);
      expect(set.has("manage_knowledge")).toBe(true);
      expect(set.has("manage_catalogs")).toBe(true);
      expect(set.has("view_quotes")).toBe(true);
      expect(set.has("view_whatsapp_mgmt")).toBe(false);
      expect(set.has("create_org")).toBe(false);
      expect(set.has("delete_org")).toBe(false);
      expect(set.has("view_all_orgs")).toBe(false);
    });

    it("super_admin has all 18 permissions", () => {
      const set = getPermissionSet("super_admin");
      expect(set.size).toBe(18);
    });

    it("super_admin set is a superset of admin set", () => {
      const adminSet = getPermissionSet("admin");
      const superSet = getPermissionSet("super_admin");
      for (const p of adminSet) {
        expect(superSet.has(p)).toBe(true);
      }
    });

    it("admin set is a superset of user set", () => {
      const userSet = getPermissionSet("user");
      const adminSet = getPermissionSet("admin");
      for (const p of userSet) {
        expect(adminSet.has(p)).toBe(true);
      }
    });
  });

  // ── ROLE_PERMISSIONS shape ─────────────────────────────────────────────────

  describe("ROLE_PERMISSIONS", () => {
    it("all super_admin entries have scope 'all'", () => {
      for (const rp of ROLE_PERMISSIONS.super_admin) {
        expect(rp.scope).toBe("all");
      }
    });

    it("no user entry has scope 'all'", () => {
      for (const rp of ROLE_PERMISSIONS.user) {
        expect(rp.scope).not.toBe("all");
      }
    });
  });
});
