// Signed optional GUI companion for the existing explicitly enabled browser server.
// No transcript scan, microphone, native-policy fallback or recorded-PID termination.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;
class TrayCompanion : ApplicationContext {
 const string StartupName="DomTTSReviewedTray";
 readonly NotifyIcon icon;
 readonly Control dispatcher=new Control();
 readonly string state;
 bool closing;
 class Connection {public string Origin;public string Token;}
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer{MaxJsonLength=8192};
 [STAThread] static int Main(string[] args){
  if(args.Length!=0)return 2;
  bool created;using(var mutex=new Mutex(true,"Local\\DomTTS.Tray."+WindowsIdentity.GetCurrent().User.Value,out created)){
   if(!created){MessageBox.Show("The Dom TTS tray is already running.","Dom TTS");return 1;}
   try{Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new TrayCompanion());return 0;}finally{mutex.ReleaseMutex();}
  }
 }
 TrayCompanion(){
  state=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"42uk","DomTTS","0.5");dispatcher.CreateControl();
  var menu=new ContextMenuStrip();
  Add(menu,"Open spoken replies",()=>{var c=Load();Process.Start(new ProcessStartInfo(c.Origin+"/#"+c.Token){UseShellExecute=true});});
  Add(menu,"Pause after current",()=>Call("queue/pause"));Add(menu,"Resume queue",()=>Call("queue/resume"));Add(menu,"Skip current",()=>Call("queue/skip"));
  Add(menu,"Stop speech and clear queue",()=>Call("stop"));Add(menu,"Restart stopped queue",()=>Call("queue/restart"));
  menu.Items.Add(new ToolStripSeparator());
  Add(menu,"Start this tray at login",EnableStartup);Add(menu,"Remove this tray from login",DisableStartup);
  Add(menu,"About",()=>MessageBox.Show("Dom TTS 0.5 development tray.\nRequires the separate local browser companion and explicit Enable.\nClosing the tray does not stop an independently owned server.\nOnly a reviewed, trusted signed build may be installed.","Dom TTS"));
  Add(menu,"Exit tray",()=>{closing=true;icon.Visible=false;icon.Dispose();dispatcher.Dispose();ExitThread();});
  icon=new NotifyIcon{Text="Dom TTS spoken replies",Icon=SystemIcons.Information,ContextMenuStrip=menu,Visible=true};
  icon.DoubleClick+=(s,e)=>Work(()=>{var c=Load();Process.Start(new ProcessStartInfo(c.Origin+"/#"+c.Token){UseShellExecute=true});});
 }
 void Add(ContextMenuStrip menu,string title,Action action){menu.Items.Add(title,null,(s,e)=>{if(title=="Exit tray"||title=="About")action();else Work(action);});}
 void Work(Action action){ThreadPool.QueueUserWorkItem(_=>{try{action();Notice("Action completed. Check the companion for playback status.");}catch{Notice("Action unavailable. Start the local companion, enable speech and let current speech settle.");}});}
 void Notice(string message){if(closing||dispatcher.IsDisposed)return;try{dispatcher.BeginInvoke((Action)(()=>{if(!closing){icon.BalloonTipTitle="Dom TTS";icon.BalloonTipText=message;icon.ShowBalloonTip(3000);}}));}catch{}}
 void CheckAcl(FileSystemSecurity acl){string owner=WindowsIdentity.GetCurrent().User.Value;foreach(FileSystemAccessRule rule in acl.GetAccessRules(true,true,typeof(SecurityIdentifier)))if(rule.AccessControlType==AccessControlType.Allow){string sid=((SecurityIdentifier)rule.IdentityReference).Value;if(sid!=owner&&sid!="S-1-5-18"&&sid!="S-1-5-32-544")throw new InvalidDataException();}}
 Connection Load(){
  string file=Path.Combine(state,"browser-session.json");for(string part=state;!String.IsNullOrEmpty(part);part=Path.GetDirectoryName(part))if((File.GetAttributes(part)&FileAttributes.ReparsePoint)!=0)throw new InvalidDataException();if(!Directory.Exists(state))throw new InvalidDataException();CheckAcl(Directory.GetAccessControl(state));
  var info=new FileInfo(file);if(!info.Exists||info.Length>4096||(info.Attributes&FileAttributes.ReparsePoint)!=0)throw new InvalidDataException();CheckAcl(File.GetAccessControl(file));
  var data=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file,new UTF8Encoding(false,true)));if(data==null||!data.ContainsKey("schema")||(string)data["schema"]!="dom-tts-browser/1"||!data.ContainsKey("port")||!(data["port"] is int)||!data.ContainsKey("token")||!(data["token"] is string))throw new InvalidDataException();
  int port=(int)data["port"];string token=(string)data["token"];if(port<1||port>65535||!System.Text.RegularExpressions.Regex.IsMatch(token,"^[a-f0-9]{64}$"))throw new InvalidDataException();return new Connection{Origin="http://127.0.0.1:"+port,Token=token};
 }
 void Call(string action){var c=Load();var request=(HttpWebRequest)WebRequest.Create(c.Origin+"/api/"+action);request.Proxy=null;request.AllowAutoRedirect=false;request.Timeout=3000;request.ReadWriteTimeout=3000;request.Method="POST";request.ContentType="application/json";request.Headers["x-dom-tts-token"]=c.Token;byte[] body=Encoding.UTF8.GetBytes("{}");request.ContentLength=body.Length;using(var stream=request.GetRequestStream())stream.Write(body,0,body.Length);using(var response=(HttpWebResponse)request.GetResponse()){if(response.StatusCode!=HttpStatusCode.OK)throw new InvalidDataException();}}
 static string StartupValue(){string executable=Process.GetCurrentProcess().MainModule.FileName;if(executable.IndexOf('"')>=0)throw new InvalidDataException();return "\""+executable+"\"";}
 void EnableStartup(){// User menu action only. Does not enable or start speech.
  using(var key=Registry.CurrentUser.CreateSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")){var existing=key.GetValue(StartupName) as string;if(existing!=null&&existing!=StartupValue())throw new InvalidDataException();key.SetValue(StartupName,StartupValue(),RegistryValueKind.String);}}
 void DisableStartup(){using(var key=Registry.CurrentUser.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run",true)){if(key==null)return;var existing=key.GetValue(StartupName) as string;if(existing!=null&&existing!=StartupValue())throw new InvalidDataException();if(existing!=null)key.DeleteValue(StartupName,false);}}
}
