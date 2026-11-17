import { JOB_SEARCH_STATUSES, REMOTE_PREFERENCES, ROLE_CATEGORIES } from "@/domain/enums";
import { enumLabel } from "@/i18n";

export const formOptions = {
  roles: ROLE_CATEGORIES.map((r) => ({ value: r, label: enumLabel("role", r) })),
  remotes: REMOTE_PREFERENCES.map((r) => ({ value: r, label: enumLabel("remote", r) })),
  jobSearch: JOB_SEARCH_STATUSES.map((r) => ({ value: r, label: enumLabel("jobSearch", r) })),
};
