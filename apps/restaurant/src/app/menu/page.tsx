import Link from "next/link";
import type { MenuItemDto } from "@raise/shared-types";
import { apiFetch } from "@/lib/api-client";
import { requireStaffSession } from "@/lib/require-staff-session";
import { AllergenChips } from "@/components/allergen-fields";
import { logoutAction, toggleAvailableAction } from "./actions";

export default async function MenuPage() {
  const session = await requireStaffSession();
  const items = await apiFetch<MenuItemDto[]>(`/restaurants/${session.restaurantId}/menu-items`, session.token, {
    cache: "no-store",
  });
  const canManage = session.role === "owner";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Menu</h1>
          <p className="mt-1 text-sm text-text-muted">{session.me.memberships[0]?.restaurantName}</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage ? (
            <Link
              href="/menu/new"
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800"
            >
              Add dish
            </Link>
          ) : null}
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-md border border-border-default px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-default px-4 py-8 text-center text-sm text-text-muted">
          No dishes yet. {canManage ? "Add your first dish to get started." : "Check back once the owner adds some."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-default rounded-lg border border-border-default">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{item.name}</span>
                  {!item.available ? (
                    <span className="rounded-full border border-border-default px-2 py-0.5 text-xs font-medium text-text-muted">
                      Disabled
                    </span>
                  ) : null}
                </div>
                <p className="text-sm text-text-muted">
                  {item.category} · ${item.price} · {item.prepTimeMinutes} min prep
                </p>
                <AllergenChips allergens={item.allergens} />
              </div>

              {canManage ? (
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href={`/menu/${item.id}/edit`}
                    aria-label={`Edit ${item.name}`}
                    className="rounded-md border border-border-default px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-surface-muted"
                  >
                    Edit
                  </Link>
                  <form action={toggleAvailableAction.bind(null, item.id, !item.available)}>
                    <button
                      type="submit"
                      aria-label={`${item.available ? "Disable" : "Enable"} ${item.name}`}
                      className="rounded-md border border-border-default px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-surface-muted"
                    >
                      {item.available ? "Disable" : "Enable"}
                    </button>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
