Class InteropTools.Installer Extends %RegisteredObject
{

ClassMethod Install(directory As %String, namespace As %String = "USER", url As %String = "/ui/interop/rule-editor") As %Status
{
    If '##class(%File).DirectoryExists(directory) {
        Quit $SYSTEM.Status.Error(5001, "The extracted package web directory must exist on the IRIS server.")
    }
    If '##class(%File).Exists(directory_"/index.html") {
        Quit $SYSTEM.Status.Error(5001, "The directory must contain the built index.html.")
    }
    If $Extract(url)'="/" {
        Quit $SYSTEM.Status.Error(5001, "The web application URL must start with /.")
    }
    New $Namespace
    Set $Namespace = "%SYS"
    If '##class(%SYS.Namespace).Exists(namespace) {
        Quit $SYSTEM.Status.Error(5001, "The target namespace does not exist.")
    }
    If ##class(Security.Applications).Exists(url) {
        Quit $SYSTEM.Status.Error(5001, "The web application already exists; update its files or choose a different URL.")
    }
    Set properties("Namespace") = namespace
    Set properties("Directory") = directory
    Set properties("Enabled") = 1
    Set properties("CSPZENEnabled") = 1
    Set properties("AutheEnabled") = 64
    Set properties("ServeFiles") = 1
    Set properties("Recurse") = 1
    Set properties("UseCookies") = 2
    Set properties("CookiePath") = url
    Quit ##class(Security.Applications).Create(url, .properties)
}

}