# Trust meetings

The meetings area records the charity's own governance: who the trustees are, when the board meets, who came, what was decided and what has to happen next. It sits alongside the client records but holds no client data.

## Who can use it

Two permissions control it:

| Permission | Lets someone |
| --- | --- |
| `meetings.view` | See meetings, registers, minutes, actions and papers |
| `meetings.manage` | Add trustees, schedule meetings, record the register, write and approve minutes, raise and close actions, upload papers |

Managers and super users have both. Caseworkers and volunteers have neither by default. To let trustees read the minutes, make a role with `meetings.view` and give it to them.

On a deployment that was set up before meetings existed, the Manager role stored in the database won't have the new permissions yet, because seeding never overwrites a role. Add them under Admin, Roles. Super users get every permission automatically.

## Trustees

Admin, Trustees holds the list of trustees and board members, with their role (Chair, Treasurer, Secretary and so on), email, the date they started and the date they stood down. A trustee can be linked to a system user so that "my actions" finds the actions they own.

Trustees are never deleted. When someone stands down, set the end date. They drop off new registers but stay on the registers of meetings they were part of.

## Meetings

A meeting has a title, a type (board, AGM, EGM, subcommittee or other), a start and optional end time, a location and an optional online link.

The agenda is an ordered list of items. Each item has a title, a presenter, notes written before the meeting and the minutes written during or after it. There is also a space for minutes that don't belong to one item, such as the opening and close.

## Register and quorum

The register lists every trustee serving on the day of the meeting. Each is marked present, sent apologies or absent. Guests (with their organisation) and staff in attendance are recorded too.

A meeting is quorate when the number of trustees present reaches the larger of:

- the minimum number of trustees, set under Admin, Organisation settings (3 by default), and
- the given share of trustees serving on the day, rounded up (off by default).

Check your governing document for the right figures. Only trustees serving on the day count, so someone who has stood down can't make a meeting quorate.

## Approving minutes

Minutes start as a draft. They're usually approved at the next meeting: choose Approve minutes and pick the meeting where that happened. Approved minutes are locked, along with the register and the list of actions raised.

If a correction is needed, Reopen minutes returns them to draft. It asks for a reason, which is kept in the audit log, and the minutes then need approving again.

## Actions

Actions are raised at a meeting with a description, an owner (a trustee or a member of staff) and an optional due date.

Open actions carry forward. Each meeting shows the actions still open from earlier meetings, so they can be reviewed in turn. Marking one done from a later meeting records that it was reported done there, and it then appears under that meeting.

The Actions tab on the meetings page lists all open actions, your own, overdue ones and finished ones. People who can see meetings get a count of overdue actions on their home page.

## Papers

Reports, accounts and other papers can be attached to a meeting. They use the same short lived upload and download links as client files, with the same allowed file types and 25 MB limit, but they're stored apart from client files and aren't affected by client anonymisation.

## Printing

Print on a meeting opens a copy laid out for paper: the register, the quorum, the minutes item by item, the actions and a space for the Chair to sign. Draft minutes are marked as drafts.

## Audit and Claude

Every view and every change is in the audit log, like the rest of the system. Through the MCP server, Claude can list and read meetings and actions, schedule meetings, record the register, update minutes and raise or close actions. Approving or reopening minutes and uploading papers can only be done in the app.
