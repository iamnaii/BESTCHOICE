# Position-first access settings

Approved direction: the owner asked to make positions the primary unit, accepted the proposed flow (configure position rights → assign employee and branches → review impact), and authorized implementation on 2026-11-24.

Use the existing position-based permissions model. Rename the settings entry/page to **ตำแหน่งและสิทธิ์**, open the **ตำแหน่ง** tab first, followed by **มอบหมายพนักงาน** and **ประวัติการเปลี่ยนแปลง**. Explain that editing a position affects its assigned employees, while branch/work scope is selected per employee assignment. Keep the existing impact review before every write.

Approach: reorder and clarify the existing console; a new permission model or assignment wizard would duplicate working capabilities and expand the approved change. The wording and tab labels are implementation choices following the approved workflow.

Constraints: retain the URL `/settings/access/employee-permissions`, owner-only UI/API protection, reserved owner grants, independent assignment tuples, and existing migration/readiness notices. No default grants, new business policies, account migration, or deployment. Continue in `feat/owner-access-console` with its own isolated preview.

Success: the settings label and page agree, positions are selected on entry, employee assignment/history remain reachable, the existing creation/assignment/revocation/review flows pass on desktop and mobile.
