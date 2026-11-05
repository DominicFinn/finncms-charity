import type { Handlers } from "../core/dispatch.js";
import { calendarHandlers } from "../calendar.js";
import { retentionHandlers } from "../jobs/retention.js";
import { activityHandlers } from "./activity.js";
import { adminHandlers } from "./admin.js";
import { auditHandlers } from "./audit.js";
import { clientHandlers } from "./clients.js";
import { consentHandlers } from "./consent.js";
import { fileHandlers } from "./files.js";
import { meHandlers } from "./me.js";
import { meetingHandlers } from "./meetings.js";
import { questionnaireHandlers } from "./questionnaires.js";
import { referralHandlers } from "./referrals.js";
import { reportHandlers } from "./reports.js";
import { safeguardingHandlers } from "./safeguarding.js";

const groups = [
  meHandlers,
  clientHandlers,
  questionnaireHandlers,
  adminHandlers,
  activityHandlers,
  fileHandlers,
  consentHandlers,
  safeguardingHandlers,
  reportHandlers,
  auditHandlers,
  retentionHandlers,
  calendarHandlers,
  referralHandlers,
  meetingHandlers,
];

export const handlers = Object.assign({}, ...groups) as Handlers;
