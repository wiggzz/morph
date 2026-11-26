// Protected host browser policy, not available to generated project code.
export function oauthNavigation(value,browser){
  try{
    const url=new URL(value),callback=new URL(browser.redirectUri);
    if(url.protocol!=='https:'||url.username||url.password)return 'block';
    if(url.origin===callback.origin&&url.pathname===callback.pathname&&!url.hash)return 'callback';
    return browser.origins.includes(url.origin)?'allow':'block';
  }catch{return 'block';}
}
