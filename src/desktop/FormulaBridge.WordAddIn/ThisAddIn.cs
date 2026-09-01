using System;
using Office = Microsoft.Office.Core;

namespace FormulaBridge.WordAddIn
{
    public sealed partial class ThisAddIn
    {
        private void ThisAddIn_Startup(object sender, EventArgs e)
        {
            WordLoadState.RecordAddInStarted(Application.Version);
        }

        private void ThisAddIn_Shutdown(object sender, EventArgs e)
        {
            WordLoadState.RecordStopped();
        }

        protected override Office.IRibbonExtensibility CreateRibbonExtensibilityObject()
        {
            return new FormulaBridgeRibbon();
        }

        private void InternalStartup()
        {
            Startup += ThisAddIn_Startup;
            Shutdown += ThisAddIn_Shutdown;
        }
    }
}
