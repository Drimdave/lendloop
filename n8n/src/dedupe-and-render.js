// Builds the message from the minimal payload and checks whether this event was
// already delivered. Convex retries on timeouts, so duplicates can happen.
const p = $json.payload;
const store = $getWorkflowStaticData('global');
const alreadySent = Boolean(store.delivered && store.delivered[p.eventId]);

const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').slice(0, 120);
const tool = oneLine(p.toolName);
const to = p.recipient;
const other = oneLine(p.otherParty?.name);
const dates = `${p.startDate} to ${p.endDate}`;

const copy = {
  'loan.requested': [`New request for your ${tool}`, `${other} would like to borrow your ${tool} (${dates}). Open LendLoop to approve or decline.`],
  'loan.approved': [`${tool}: request approved`, `${other} approved your request to borrow the ${tool} (${dates}). Please return it on time.`],
  'loan.declined': [`${tool}: request declined`, `${other} could not lend the ${tool} for ${dates}. Other tools may be available on LendLoop.`],
  'loan.cancelled': [`${tool}: request withdrawn`, `${other} withdrew their request for your ${tool} (${dates}). No action needed.`],
  'loan.returned': [`${tool}: marked as returned`, `${other} marked the ${tool} as returned. Thank you for using LendLoop.`],
}[p.type];
if (!copy) throw new Error(`Unknown event type: ${oneLine(p.type)}`);

return [
  {
    json: {
      eventId: p.eventId,
      alreadySent,
      to: to.email,
      subject: copy[0],
      text: `Hi ${oneLine(to.name)},\n\n${copy[1]}\n\nLendLoop`,
    },
  },
];
