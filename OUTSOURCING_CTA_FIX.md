# Outsourcing CTA Repair Note

The active `/outsourcing` page renders “Discuss your outsourcing need” as a Wouter `Link` pointing to `#outsourcing-enquiry`. Browser testing showed the control remained on the current section rather than scrolling to the form.

Capture-phase handling was added to the scroll manager, but direct browser testing still showed the router-managed CTA did not reliably move to the form. The final repair therefore uses native `<a>` elements for the active in-page outsourcing anchors and makes the shared editorial button render a native anchor when its destination begins with `#`. This preserves smooth scrolling to `#outsourcing-enquiry` and avoids the router intercepting the interaction.

Final browser validation targets the dedicated **Discuss your outsourcing need** link itself, rather than the adjacent “See how we deliver” link.
