const GLib = imports.gi.GLib;
const Main = imports.ui.main;
const Config = imports.misc.config;
const Version = parseInt(Config.PACKAGE_VERSION.split('.')[0]);
const ImportClass = Version == 3 ? imports.ui.viewSelector.ViewSelector : imports.ui.overviewControls.ControlsManager;
const ShowAppsButton = Version == 3 ? Main.overview.viewSelector._showAppsButton : Main.overview.dash.showAppsButton;
const OverviewShowApps = Version == 3 ? Main.overview.viewSelector : Main.overview;
const MainOverview = Version == 3 ? Main.overview.viewSelector : Main.overview.dash;
const Meta = imports.gi.Meta;
const WindowManager = imports.ui.windowManager;
const St = imports.gi.St;

let _signal = [];
let _function;

let _idle = null;

// this timeout takes into account window animation times (if enabled)
// before showing the apps overview
let _showAppsTimeout = null;

let _manager, _workspace, _monitor;

var _showAppsButtonChecked;

const acceptedWindowTypes = [ Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG ];

function removeTimer()
{
    if (_showAppsTimeout == null)
        return;

    GLib.Source.remove(_showAppsTimeout);
    _showAppsTimeout = null;
}

function setTimer(interval)
{
    _showAppsTimeout = GLib.timeout_add(GLib.PRIORITY_LOW, interval, () => {
        showApps();
        return GLib.SOURCE_REMOVE;
    });
}

function windowAccepted(window)
{
    if (window.is_hidden() || acceptedWindowTypes.indexOf(window.get_window_type()) == -1)
        return false;

    return true;
}

function hideApps()
{
    // hide the overview only if we're in application view
    if (ShowAppsButton.checked)
        Main.overview.hide();
}

function showApps()
{
    if (_workspace.list_windows().filter(window => windowAccepted(window)).length == 0)
        OverviewShowApps.showApps();
}

function windowAdded(workspace, window)
{
    if (workspace != _workspace)
        return;

    if (!windowAccepted(window))
        return;

    hideApps();
}

function windowRemoved(workspace, window)
{
    if (workspace != _workspace)
        return;

    if (!windowAccepted(window))
        return;

    if (!St.Settings.get().enable_animations)
    {
        showApps();
        return;
    }

    removeTimer();

    setTimer(window.get_window_type() == Meta.WindowType.NORMAL ? WindowManager.DESTROY_WINDOW_ANIMATION_TIME : WindowManager.DIALOG_DESTROY_WINDOW_ANIMATION_TIME);
}

function disconnectWindowSignals()
{
    if (_signal['window-added'])
        _workspace.disconnect(_signal['window-added']);

    if (_signal['window-removed'])
        _workspace.disconnect(_signal['window-removed']);
}

function getWorkspace()
{
    _workspace = _manager.get_active_workspace();

    _signal['window-added'] = _workspace.connect('window-added', (workspace, window) => windowAdded(workspace, window));
    _signal['window-removed'] = _workspace.connect('window-removed', (workspace, window) => windowRemoved(workspace, window));
}

function checkWorkspace()
{
    disconnectWindowSignals();

    getWorkspace();

    if (!Main.overview.visible)
        showApps();
    else if (_workspace.list_windows().filter(window => windowAccepted(window)).length > 0)
        hideApps();
}

function overviewHidden()
{
    // don't show the apps view if we were already looking at it
    if (!_showAppsButtonChecked)
        showApps();
}

function animateFromOverview(callback)
{
    // the original function sets _showAppsButton.checked = false, so we need to copy it to a local variable first
    _showAppsButtonChecked = ShowAppsButton.checked;
    _function.apply(this, [callback]);
}

function init()
{
    _manager = global.screen;
    if (_manager == undefined)
        _manager = global.workspace_manager;

    _monitor = global.display.get_primary_monitor();
}

function enable()
{
    _showAppsButtonChecked = ShowAppsButton.checked;

    _function = ImportClass.prototype.animateFromOverview;
    ImportClass.prototype.animateFromOverview = animateFromOverview;

    getWorkspace();

    _signal['workspace-switched'] = _manager.connect('workspace-switched', checkWorkspace);
    _signal['overview-hidden'] = Main.overview.connect('hidden', overviewHidden);

    if (!Main.layoutManager._startingUp)
        return;

    // shows applications at startup/login, but waits for mainloop to turn idle first
    // we need to handle Gnome Shell 40 first
    if (Version != 3)
        // pointless restoring this variable as it only affects session startup
        Main.sessionMode.hasOverview = false;

    // 1 millisecond might seem pointless but, without using a timer,
    // the application view never shows otherwise
    _idle = GLib.idle_add(GLib.PRIORITY_LOW, () => {
        setTimer(1);
        return GLib.SOURCE_REMOVE;
    });
}

function disable()
{
    removeTimer();
    disconnectWindowSignals();

    Main.overview.disconnect(_signal['overview-hidden']);
    _manager.disconnect(_signal['workspace-switched']);

    ImportClass.prototype.animateFromOverview = _function;

    if (_idle)
    {
        GLib.Source.remove(_idle);
        _idle = null;
    }
}
