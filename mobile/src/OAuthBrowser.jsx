import React,{useRef,useState} from 'react';
import {Modal,View,Text,Pressable,ActivityIndicator} from 'react-native';
import {WebView} from 'react-native-webview';
import {oauthNavigation} from './oauthBrowser';
export function OAuthBrowser({auth,onCancel,onCallback}){
  const finished=useRef(false),[host,setHost]=useState(()=>new URL(auth.url).hostname),[error,setError]=useState(''),[finishing,setFinishing]=useState(false),[blocked,setBlocked]=useState(false);
  const navigate=request=>{
    const decision=oauthNavigation(request.url,auth.browser);
    if(decision==='callback'){
      if(!finished.current){finished.current=true;setFinishing(true);onCallback(request.url);}
      return false;
    }
    if(decision==='allow'&&!finished.current){setHost(new URL(request.url).hostname);return true;}
    if(!finished.current)setError('Navigation outside the declared HTTPS sign-in sites was blocked.');
    return false;
  };
  return <Modal visible animationType="slide" onRequestClose={onCancel}><View style={{flex:1,paddingTop:45,backgroundColor:'#0a1219'}}>
    <View style={{padding:14,gap:8}}><Text style={{color:'#edf4ee',fontSize:18}}>Protected sign-in · {auth.label||'account'}</Text><Text style={{color:'#91aab3'}}>Website: {host}</Text><Text style={{color:'#91aab3',fontSize:11}}>Enter credentials and MFA only on the provider’s page. This isolated browser is not editable app code. Incognito mode; cookies are not exposed to app code.</Text><Pressable onPress={onCancel}><Text style={{color:'#7de2ce',padding:8}}>Cancel sign-in</Text></Pressable>{!!(error||auth.error)&&<Text style={{color:'#ffb3ab'}}>{error||auth.error}</Text>}</View>
    {blocked?<Text style={{color:'#ffb3ab',padding:20}}>Sign-in stopped because the website left its declared login origins. Cancel and review the recipe.</Text>:finishing?<View style={{padding:20,gap:12}}>{!auth.error&&<ActivityIndicator/>}<Text style={{color:'#edf4ee'}}>{auth.error?'Cancel and reconnect from Accounts.':'Completing secure token exchange…'}</Text></View>:<WebView source={{uri:auth.url}} incognito sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false} javaScriptEnabled domStorageEnabled originWhitelist={['*']} onShouldStartLoadWithRequest={navigate} onNavigationStateChange={navigation=>{if(navigation.url==='about:blank')return;const decision=oauthNavigation(navigation.url,auth.browser);if(decision==='callback')navigate(navigation);else if(decision==='block'){setBlocked(true);setError('Blocked navigation outside the declared HTTPS sign-in sites.');}else setHost(new URL(navigation.url).hostname);}} onError={()=>setError('Sign-in page failed to load. Cancel and try connecting again.')} onRenderProcessGone={()=>setError('Sign-in browser stopped. Cancel and reconnect.')} allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false} mixedContentMode="never" javaScriptCanOpenWindowsAutomatically={false} setSupportMultipleWindows={false} geolocationEnabled={false} mediaPlaybackRequiresUserAction allowsInlineMediaPlayback={false}/>}
  </View></Modal>;
}
