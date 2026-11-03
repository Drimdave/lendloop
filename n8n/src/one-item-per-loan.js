// Turns Convex's { date, loans: [...] } answer into one item per overdue loan.
// Returning no items ends the run quietly when nothing is overdue.
const { loans = [] } = $input.first().json;
return loans.map((loan) => ({ json: loan }));
