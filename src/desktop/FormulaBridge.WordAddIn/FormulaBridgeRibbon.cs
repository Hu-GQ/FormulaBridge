using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using Office = Microsoft.Office.Core;

namespace FormulaBridge.WordAddIn
{
    [ComVisible(true)]
    public sealed class FormulaBridgeRibbon : Office.IRibbonExtensibility
    {
        public string GetCustomUI(string ribbonId)
        {
            const string resourceName = "FormulaBridge.WordAddIn.FormulaBridgeRibbon.xml";

            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName))
            {
                if (stream == null)
                {
                    throw new InvalidOperationException("The FormulaBridge Ribbon resource is missing.");
                }

                using (var reader = new StreamReader(stream))
                {
                    return reader.ReadToEnd();
                }
            }
        }

        public void Ribbon_Load(Office.IRibbonUI ribbon)
        {
            WordLoadState.RecordRibbonLoaded();
        }
    }
}
