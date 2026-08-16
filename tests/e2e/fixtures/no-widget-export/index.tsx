// Typechecks and builds fine, but the default export never renders
// `<Widget>` — TypeScript can't catch "this JSX tree's root is <Widget>" on
// its own (see docs/widgets.md's "A widget is one folder"), so this is
// `widget:check`'s job: it renders the built bundle and greps for the
// `data-wigl-widget` marker. This fixture exists to fail exactly that check
// while passing every earlier stage.
const NoWidgetExport = () => <div>not wrapped in Widget</div>;

export default NoWidgetExport;
