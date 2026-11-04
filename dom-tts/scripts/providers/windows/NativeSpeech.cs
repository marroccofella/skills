// Optional signed Windows provider. No shell, network, microphone or persistence.
// The existing Dom TTS worker owns and stops this process; CHUNK is its protocol.
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Speech.Synthesis;
using System.Text;
using System.Web.Script.Serialization;
class NativeSpeech {
 static int Main(string[] args) {
  Console.OutputEncoding=new UTF8Encoding(false);
  try {
   using(var speaker=new SpeechSynthesizer()) {
    if(args.Length==1&&args[0]=="--voices") {
     foreach(var voice in speaker.GetInstalledVoices())if(voice.Enabled)Console.WriteLine(voice.VoiceInfo.Name);
     return 0;
    }
    if(args.Length!=2||args[0]!="--input-file")throw new InvalidDataException();
    string json;
    using(var file=new FileStream(args[1],FileMode.Open,FileAccess.Read,FileShare.Read)) {
     if(file.Length>1048576)throw new InvalidDataException();
     using(var reader=new StreamReader(file,new UTF8Encoding(false,true)))json=reader.ReadToEnd();
    }
    var payload=new JavaScriptSerializer{MaxJsonLength=1048576}.Deserialize<Dictionary<string,object>>(json);
    if(payload==null||payload.Count!=3||!payload.ContainsKey("chunks")||!payload.ContainsKey("voice")||!payload.ContainsKey("rate"))throw new InvalidDataException();
    if(!(payload["rate"] is int)||!(payload["voice"] is string)||!(payload["chunks"] is IEnumerable)||payload["chunks"] is string)throw new InvalidDataException();
    int rate=(int)payload["rate"];if(rate < -10||rate > 10)throw new InvalidDataException();speaker.Rate=rate;
    string requested=(string)payload["voice"];
    if(requested.Length>256)throw new InvalidDataException();
    if(requested!="") {
     bool found=false;foreach(var installed in speaker.GetInstalledVoices())if(installed.Enabled&&installed.VoiceInfo.Name==requested)found=true;
     if(!found){Console.Error.WriteLine("SelectVoice: unavailable");return 3;}
     speaker.SelectVoice(requested);
    }
    var chunks=new List<string>();int total=0;
    foreach(var item in (IEnumerable)payload["chunks"]) {
     var text=item as string;if(text==null||chunks.Count>=4096)throw new InvalidDataException();
     total+=Encoding.UTF8.GetByteCount(text);if(total>1048576)throw new InvalidDataException();chunks.Add(text);
    }
    speaker.SetOutputToDefaultAudioDevice();
    for(int i=0;i<chunks.Count;i++){Console.WriteLine("CHUNK "+i);Console.Out.Flush();speaker.Speak(chunks[i]);}
    return 0;
   }
  }catch(InvalidDataException){Console.Error.WriteLine("DOM_TTS_INVALID_INPUT");return 2;}
   catch{Console.Error.WriteLine("DOM_TTS_ENGINE_FAILED");return 5;}
 }
}
