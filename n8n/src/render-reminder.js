// Builds the reminder for one overdue loan. Uses only the fields Convex sent.
const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').slice(0, 120);
const days = Number($json.daysOverdue);
const tool = oneLine($json.toolName);
return {
  json: {
    loanId: $json.loanId,
    reminderKey: $json.reminderKey,
    to: $json.borrower.email,
    subject: `Reminder: please return the ${tool}`,
    text:
      `Hi ${oneLine($json.borrower.name)},\n\n` +
      `The ${tool} was due back on ${$json.dueDate}, ${days} day${days === 1 ? '' : 's'} ago. ` +
      `Please return it to the lender as soon as you can.\n\nLendLoop`,
  },
};
