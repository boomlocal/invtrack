import { useState, useCallback, useEffect } from "react";

function uid() { return Math.random().toString(36).slice(2, 10); }
function now() { return new Date().toISOString(); }
function defaultStore() {
  return { vendors: [], clients: [], inventory: [], rfps: [], invoices: [], activityLog: [],
    company: { name: "Pura Research Labs LLC", email: "phil@puraresearchlabs.com", phone: "+1-239-506-3434", address: "1242 SW Pine Island Rd, Suite 42-291, Cape Coral, FL 33991 USA", website: "" }
  };
}

function generateBarcodeSVG(text, width = 280, height = 80) {
  const C = { " ":[2,1,2,2,2,2],"0":[1,2,3,1,2,2],"1":[1,2,3,2,2,1],"2":[2,2,3,2,1,1],"3":[2,2,1,1,3,2],"4":[2,2,1,2,3,1],"5":[2,1,3,2,1,2],"6":[2,2,3,1,1,2],"7":[3,1,2,1,3,1],"8":[3,1,1,2,2,2],"9":[3,2,1,1,2,2],"A":[3,2,1,2,2,1],"B":[3,1,2,2,1,2],"C":[3,2,2,1,1,2],"D":[3,2,2,2,1,1],"E":[2,1,2,1,2,3],"F":[2,1,2,3,2,1],"G":[2,3,2,1,2,1],"H":[1,1,1,3,2,3],"I":[1,3,1,1,2,3],"J":[1,3,1,3,2,1],"K":[1,1,2,3,1,3],"L":[1,3,2,1,1,3],"M":[1,3,2,3,1,1],"N":[2,1,1,3,1,3],"O":[2,3,1,1,1,3],"P":[2,3,1,3,1,1],"Q":[1,1,2,1,3,3],"R":[1,1,2,3,3,1],"S":[1,3,2,1,3,1],"T":[1,1,3,1,2,3],"U":[1,1,3,3,2,1],"V":[1,3,3,1,2,1],"W":[3,1,3,1,2,1],"X":[2,1,1,3,3,1],"Y":[2,3,1,1,3,1],"Z":[2,1,3,1,1,3],"-":[1,2,2,1,3,2],".":[1,2,2,2,3,1],"/":[1,1,3,2,2,2] };
  const START=[2,1,1,4,1,2], STOP=[2,3,3,1,1,1,2];
  const chars=text.toUpperCase().replace(/[^A-Z0-9 \-./]/g,"?");
  const patterns=[START,...chars.split("").map(c=>C[c]||C["?"]),STOP];
  const total=patterns.reduce((s,p)=>s+p.reduce((a,b)=>a+b,0),0)+2;
  const uw=width/total; let bars=[],x=uw;
  patterns.forEach(p=>p.forEach((u,i)=>{if(i%2===0)bars.push({x,w:u*uw});x+=u*uw;}));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="white"/>${bars.map(b=>`<rect x="${b.x.toFixed(1)}" y="0" width="${b.w.toFixed(1)}" height="${height-16}" fill="#000"/>`).join("")}<text x="${width/2}" y="${height-2}" text-anchor="middle" font-family="monospace" font-size="11">${text}</text></svg>`;
}

async function parseFileWithClaude(fileData, fileType) {
  const isImage = fileType.startsWith("image/");
  const msgContent = isImage
    ? [{type:"image",source:{type:"base64",media_type:fileType,data:fileData}},{type:"text",text:'You are a data extraction assistant. Look at this pricing catalog image carefully. Extract EVERY product you can see into a JSON array. Each product needs: name (product name), sku (abbreviation/code), price (number only, no $ sign), strength (dosage/size/specification). Return ONLY the raw JSON array with no markdown, no explanation, no code blocks. Example format: [{"name":"BPC-157","sku":"BP5","price":45,"strength":"5mg*10vials"}]. Extract ALL products visible, even if there are hundreds.'}]
    : [{type:"document",source:{type:"base64",media_type:"application/pdf",data:fileData}},{type:"text",text:'You are a data extraction assistant. Extract EVERY product from this pricing document. Each product needs: name (product name), sku (abbreviation/code), price (number only, no $ sign), strength (dosage/size/specification). Return ONLY the raw JSON array with no markdown, no explanation, no code blocks. Example format: [{"name":"BPC-157","sku":"BP5","price":45,"strength":"5mg*10vials"}]. Extract ALL products, even if there are hundreds.'}];

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),30000);

  try{
    const res=await fetch("/.netlify/functions/claude",{
      method:"POST",
      signal:controller.signal,
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({content:msgContent})
    });
    clearTimeout(timeout);
    if(!res.ok){console.error("API error:",res.status);return [];}
    const data=await res.json();
    console.log("API response:",JSON.stringify(data).slice(0,500));
    if(data.stop_reason&&data.stop_reason!=="end_turn"){
      showToast("AI stopped early: "+data.stop_reason,T.amber);
    }
    const raw=(data.text||"[]");
    // Strip any markdown code fences
    const stripped=raw.replace(/```json/gi,"").replace(/```/g,"").trim();
    // Try direct parse first
    try{return JSON.parse(stripped);}catch{}
    // Try to extract array from anywhere in the text
    const match=stripped.match(/\[[\s\S]*\]/);
    if(match){
      try{return JSON.parse(match[0]);}catch(e){
        // Array found but malformed - try to fix truncation
        console.error("Parse error:",e.message);
      }
    }
    // Try line by line extraction as last resort
    const lines=stripped.split("\n");
    const products=[];
    let current={};
    for(const line of lines){
      const nameMatch=line.match(/"name"\s*:\s*"([^"]+)"/);
      const skuMatch=line.match(/"sku"\s*:\s*"([^"]+)"/);
      const priceMatch=line.match(/"price"\s*:\s*([\d.]+)/);
      const strengthMatch=line.match(/"strength"\s*:\s*"([^"]+)"/);
      if(nameMatch)current.name=nameMatch[1];
      if(skuMatch)current.sku=skuMatch[1];
      if(priceMatch)current.price=parseFloat(priceMatch[1]);
      if(strengthMatch){current.strength=strengthMatch[1];if(current.name){products.push({...current});current={};}}
    }
    if(products.length>0)return products;
    return [];
  }catch(err){
    clearTimeout(timeout);
    console.error("Claude API error:",err);
    return [];
  }
}

// ── Medical/Clinical Theme ────────────────────────────────────────────────────
// Dark: deep clinical navy — like a high-end medical software suite
const DARK = {
  bg:"#0a0f1a",           // Deep midnight navy
  bgPanel:"#0e1628",      // Slightly lighter panel
  bgCard:"#121d35",       // Card surfaces
  bgCardHover:"#162340",
  border:"rgba(99,179,237,0.12)",
  borderHi:"rgba(99,179,237,0.35)",
  accent:"#63b3ed",       // Clinical blue — calm, precise
  accentDark:"#2b6cb0",
  accentDim:"rgba(99,179,237,0.1)",
  accentGlow:"rgba(99,179,237,0.25)",
  green:"#68d391",        // Vital green — health indicator
  greenDark:"#276749",
  greenDim:"rgba(104,211,145,0.12)",
  amber:"#f6ad55",        // Alert amber
  amberDim:"rgba(246,173,85,0.12)",
  red:"#fc8181",          // Critical red
  redDim:"rgba(252,129,129,0.12)",
  purple:"#b794f4",       // Lab purple
  purpleDim:"rgba(183,148,244,0.12)",
  teal:"#4fd1c7",         // Medical teal accent
  tealDim:"rgba(79,209,199,0.12)",
  text:"#e8f0fe",         // Crisp near-white
  textMid:"#90afd4",      // Mid blue-grey — readable
  textDim:"#4a6a8a",      // Dimmed
  inputBg:"#0e1628",
  scrollThumb:"rgba(99,179,237,0.25)",
  shadow:"rgba(0,0,0,0.4)",
};

// Light: clean clinical white — hospital/lab precision
const LIGHT = {
  bg:"#f0f4f8",           // Cool clinical grey-white
  bgPanel:"#ffffff",      // Pure white panels
  bgCard:"#f7fafc",       // Very light card
  bgCardHover:"#edf2f7",
  border:"rgba(74,130,180,0.15)",
  borderHi:"rgba(44,130,201,0.4)",
  accent:"#2b6cb0",       // Deep clinical blue
  accentDark:"#1a4a82",
  accentDim:"rgba(43,108,176,0.08)",
  accentGlow:"rgba(43,108,176,0.2)",
  green:"#276749",        // Clinical green
  greenDark:"#1a4a33",
  greenDim:"rgba(39,103,73,0.08)",
  amber:"#744210",        // Warning amber
  amberDim:"rgba(116,66,16,0.08)",
  red:"#9b2335",          // Alert red
  redDim:"rgba(155,35,53,0.08)",
  purple:"#553c9a",       // Lab purple
  purpleDim:"rgba(85,60,154,0.08)",
  teal:"#285e61",         // Medical teal
  tealDim:"rgba(40,94,97,0.08)",
  text:"#1a202c",         // Near black — maximum readability
  textMid:"#2d4a6a",      // Dark blue-grey
  textDim:"#607d9a",      // Muted
  inputBg:"#ffffff",
  scrollThumb:"rgba(43,108,176,0.25)",
  shadow:"rgba(0,0,0,0.08)",
};

let T = {...DARK, font:"'Inter','Poppins',system-ui,sans-serif", mono:"'Roboto Mono','Courier New',monospace", radius:"8px", radiusLg:"12px", radiusFull:"100px" };

function buildT(mode, fontId) {
  const base = mode === "dark" ? DARK : LIGHT;
  const font = fontId === "roboto" ? "'Roboto',system-ui,sans-serif" : fontId === "poppins" ? "'Poppins',system-ui,sans-serif" : "'Inter','Poppins',system-ui,sans-serif";
  return {...base, font, mono:"'Roboto Mono','Courier New',monospace", radius:"8px", radiusLg:"12px", radiusFull:"100px"};
}

function getSC(t) {
  return { "Draft":{color:t.textMid,bg:t.textMid+"28"},"Sent":{color:t.accent,bg:t.accent+"22"},"Quote Received":{color:t.purple,bg:t.purple+"22"},"Accepted":{color:t.green,bg:t.green+"22"},"Pending":{color:t.amber,bg:t.amber+"22"},"Declined":{color:t.red,bg:t.red+"22"},"Paid":{color:t.green,bg:t.green+"22"},"Overdue":{color:t.red,bg:t.red+"22"},"Cancelled":{color:t.textDim,bg:t.textDim+"28"} };
}
let SC = getSC(T);
let STATUS_COLORS = Object.fromEntries(Object.entries(SC).map(([k,v])=>[k,v.color]));

function getIS() { return { width:"100%",background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,padding:"9px 12px",fontSize:13,fontFamily:T.font,outline:"none",boxSizing:"border-box" }; }
let IS = getIS();

function getTIER() { return { Complete:{bg:T.greenDim,border:T.green+"55",text:T.green},Partial:{bg:T.amberDim,border:T.amber+"55",text:T.amber},Minimal:{bg:T.textDim+"22",border:T.textDim+"44",text:T.textMid} }; }
let TIER = getTIER();

const INDUSTRIES = ["Medical Supplies","Pharmaceuticals","Peptide Manufacturer","Lab Equipment","Office Supplies","Technology","Wholesale","Distribution","Manufacturing","Other"];
const PAYMENT_TERMS = ["Net 15","Net 30","Net 60","Due on Receipt","COD","Prepaid"];
const US_STATES = ["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"];
const COUNTRIES = [{code:"US",label:"🇺🇸 United States"},{code:"CA",label:"🇨🇦 Canada"},{code:"GB",label:"🇬🇧 United Kingdom"},{code:"AU",label:"🇦🇺 Australia"},{code:"DE",label:"🇩🇪 Germany"},{code:"OTHER",label:"🌐 Other"}];
const NAV = [{id:"dashboard",label:"Dashboard",icon:"◫"},{id:"vendors",label:"Vendors",icon:"◈"},{id:"rfp",label:"RFPs",icon:"◎"},{id:"inventory",label:"Inventory",icon:"▦"},{id:"clients",label:"Clients",icon:"◉"},{id:"invoices",label:"Invoices",icon:"◻"},{id:"log",label:"Activity",icon:"≡"},{id:"admin",label:"Settings",icon:"⚙"}];
const RFP_STATUSES = ["Draft","Sent","Quote Received","Accepted","Pending","Declined"];
const INV_STATUSES = ["Draft","Sent","Paid","Overdue","Cancelled"];

function vendorInitials(n){return n.split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase();}
function vendorCompleteness(v){const c=[!!v.name,!!v.contactName,!!v.contactPhone,!!v.email,!!v.businessNumber,!!v.industry,!!v.address,!!v.city,!!(v.state||v.country!=="US"),!!v.zip,!!v.country,!!v.paymentTerms,!!v.notes];const s=c.filter(Boolean).length;const p=Math.round((s/c.length)*100);return{pct:p,tier:p>=75?"Complete":p>=35?"Partial":"Minimal"};}

function Btn({children,onClick,small,ghost,danger,primary,disabled,style={}}){
  const bg=danger?T.redDim:primary?T.accent:ghost?"transparent":T.accentDim;
  const border=danger?`1px solid ${T.red}55`:primary?"none":ghost?`1px solid ${T.border}`:`1px solid ${T.borderHi}`;
  const color=danger?T.red:primary?"#fff":ghost?T.textMid:T.accent;
  const shadow=primary?`0 2px 8px ${T.accentGlow}`:"none";
  return <button onClick={onClick} disabled={disabled} style={{background:bg,border,color,borderRadius:T.radius,padding:small?"5px 14px":"9px 22px",cursor:disabled?"not-allowed":"pointer",fontSize:small?11:13,fontWeight:600,fontFamily:T.font,opacity:disabled?0.4:1,whiteSpace:"nowrap",boxShadow:shadow,letterSpacing:0.3,...style}}>{children}</button>;
}
function Lbl({children}){return <div style={{fontSize:10,color:T.textDim,fontFamily:T.mono,fontWeight:600,letterSpacing:1.5,marginBottom:6,textTransform:"uppercase"}}>{children}</div>;}
function Chip({children,color}){return <span style={{background:color+"22",border:`1px solid ${color}44`,color,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:600}}>{children}</span>;}
function SBadge({status}){const s=getSC(T)[status]||{color:T.textMid,bg:T.textMid+"28"};return <span style={{background:s.bg,color:s.color,borderRadius:T.radiusFull||100,padding:"3px 10px",fontSize:10,fontWeight:600,fontFamily:T.mono,border:`1px solid ${s.color}33`,letterSpacing:0.3}}>{status}</span>;}

function AdminPanel({themeMode,setThemeMode,fontChoice,setFontChoice,company,setCompany}){
  const [co,setCo]=useState({...company});
  function saveCompany(){setCompany(co);showToastGlobal("Company details saved");}
  function showToastGlobal(msg){/* handled by parent */}

  return(
    <div style={{padding:"40px 48px",maxWidth:640}}>
      <div style={{fontSize:11,color:T.accent,fontFamily:T.mono,letterSpacing:3,textTransform:"uppercase",marginBottom:6}}>System Configuration</div>
      <h1 style={{fontSize:26,fontWeight:700,color:T.text,marginBottom:32}}>Admin Settings</h1>

      {/* Company Info */}
      <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.radiusLg,padding:"28px 32px",marginBottom:24}}>
        <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:4}}>Company Information</div>
        <div style={{fontSize:13,color:T.textMid,marginBottom:20}}>Used on Quote Request Forms, Invoices, and other documents.</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:16}}>
          {[
            {k:"name",l:"Company Name",ph:"e.g. Pura Research Labs LLC",span:true},
            {k:"email",l:"Company Email",ph:"billing@company.com"},
            {k:"phone",l:"Phone Number",ph:"(555) 000-0000"},
            {k:"address",l:"Address",ph:"123 Main St, City, State ZIP"},
            {k:"website",l:"Website",ph:"https://company.com"},
          ].map(f=>(
            <div key={f.k} style={f.span?{gridColumn:"1/-1"}:{}}>
              <Lbl>{f.l}</Lbl>
              <input value={co[f.k]||""} onChange={e=>setCo(c=>({...c,[f.k]:e.target.value}))} placeholder={f.ph} style={IS}/>
            </div>
          ))}
        </div>
        <Btn primary onClick={()=>setCompany(co)}>Save Company Details</Btn>
      </div>
      <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.radiusLg,padding:"28px 32px",marginBottom:24}}>
        <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:4}}>Appearance</div>
        <div style={{fontSize:13,color:T.textMid,marginBottom:20}}>Choose between a dark or light background theme.</div>
        <div style={{display:"flex",gap:16}}>
          {[{id:"dark",label:"Dark Mode",desc:"Deep navy — easy on the eyes",previewBg:"#060c18",previewPanel:"#0b1525",previewText:"#eef5ff",previewAccent:"#00c8ff"},{id:"light",label:"Light Mode",desc:"Clean white — crisp and bright",previewBg:"#f3f6fb",previewPanel:"#ffffff",previewText:"#0c1a2e",previewAccent:"#0068c0"}].map(opt=>{
            const active=themeMode===opt.id;
            return(
              <div key={opt.id} onClick={()=>setThemeMode(opt.id)} style={{flex:1,border:`2px solid ${active?T.accent:T.border}`,borderRadius:T.radius,padding:18,cursor:"pointer",background:active?T.accentDim:T.bgPanel}}>
                <div style={{background:opt.previewBg,borderRadius:8,padding:"10px 12px",marginBottom:14,display:"flex",gap:8,alignItems:"center"}}>
                  <div style={{width:38,background:opt.previewPanel,borderRadius:5,padding:"6px 0",display:"flex",flexDirection:"column",gap:3,alignItems:"center"}}>
                    {[opt.previewAccent,opt.previewText+"aa",opt.previewText+"55"].map((c,i)=><div key={i} style={{width:26,height:4,borderRadius:2,background:c}}/>)}
                  </div>
                  <div style={{flex:1,display:"flex",flexDirection:"column",gap:4}}>
                    <div style={{height:6,borderRadius:3,background:opt.previewText,width:"70%",opacity:0.9}}/>
                    <div style={{height:4,borderRadius:3,background:opt.previewText,width:"50%",opacity:0.5}}/>
                    <div style={{height:18,borderRadius:4,background:opt.previewAccent+"33",width:"100%",marginTop:4}}/>
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:2}}>{opt.label}</div>
                    <div style={{fontSize:12,color:T.textMid}}>{opt.desc}</div>
                  </div>
                  <div style={{width:20,height:20,borderRadius:"50%",border:`2px solid ${active?T.accent:T.border}`,background:active?T.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    {active&&<div style={{width:8,height:8,borderRadius:"50%",background:T.bg}}/>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.radiusLg,padding:"28px 32px"}}>
        <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:4}}>Typography</div>
        <div style={{fontSize:13,color:T.textMid,marginBottom:20}}>Select the primary font used throughout the app.</div>
        <div style={{display:"flex",gap:16}}>
          {[{id:"poppins",label:"Poppins"},{id:"roboto",label:"Roboto"}].map(f=>{
            const active=fontChoice===f.id;
            const ff=f.id==="roboto"?"'Roboto',system-ui,sans-serif":"'Poppins',system-ui,sans-serif";
            return(
              <div key={f.id} onClick={()=>setFontChoice(f.id)} style={{flex:1,border:`2px solid ${active?T.accent:T.border}`,borderRadius:T.radius,padding:"18px 20px",cursor:"pointer",background:active?T.accentDim:T.bgPanel}}>
                <div style={{fontFamily:ff,fontSize:20,fontWeight:700,color:T.text,marginBottom:4}}>{f.label}</div>
                <div style={{fontSize:11,color:T.accent,marginBottom:8,fontWeight:500}}>{f.desc}</div>
                <div style={{fontFamily:ff,fontSize:13,color:T.textMid,marginBottom:6}}>The quick brown fox jumps over the lazy dog</div>
                <div style={{fontFamily:ff,fontSize:11,color:T.textDim}}>ABCDEFGHIJKLMNOPQRSTUVWXYZ · 0123456789</div>
                <div style={{marginTop:12,display:"flex",justifyContent:"flex-end"}}>
                  <div style={{width:18,height:18,borderRadius:"50%",border:`2px solid ${active?T.accent:T.border}`,background:active?T.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {active&&<div style={{width:7,height:7,borderRadius:"50%",background:T.bg}}/>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Dashboard({store,setTab,lowStock,outOfStock}){
  const totalVal=store.inventory.reduce((s,i)=>s+(i.qty*(i.costPrice||0)),0);
  const openRFPs=store.rfps.filter(r=>["Sent","Quote Received","Pending"].includes(r.status)).length;
  const savings=store.rfps.reduce((s,r)=>s+parseFloat(r.savings||0),0);
  const unpaid=store.invoices.filter(i=>["Sent","Overdue"].includes(i.status));
  const unpaidTotal=unpaid.reduce((s,i)=>s+i.total,0);
  const kpis=[{label:"Inventory Value",value:`$${totalVal.toFixed(2)}`,sub:`${store.inventory.length} products`,color:T.accent,icon:"▦"},{label:"Open RFPs",value:openRFPs,sub:`${store.rfps.length} total`,color:T.purple,icon:"◎"},{label:"Total Savings",value:`$${savings.toFixed(2)}`,sub:"from accepted RFPs",color:T.green,icon:"↓"},{label:"Outstanding",value:`$${unpaidTotal.toFixed(2)}`,sub:`${unpaid.length} invoices`,color:T.amber,icon:"◫"}];
  return(
    <div style={{padding:"32px 36px"}}>
      <div style={{marginBottom:28,display:"flex",justifyContent:"space-between",alignItems:"flex-end",paddingBottom:20,borderBottom:`1px solid ${T.border}`}}>
        <div>
          <div style={{fontSize:10,color:T.accent,fontFamily:T.mono,letterSpacing:2,textTransform:"uppercase",marginBottom:8,fontWeight:600}}>● LIVE · SYSTEM OVERVIEW</div>
          <h1 style={{fontSize:26,fontWeight:700,color:T.text,letterSpacing:-0.5}}>Dashboard</h1>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:13,color:T.text,fontWeight:500}}>{new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</div>
          <div style={{fontSize:11,color:T.textDim,marginTop:2,fontFamily:T.mono}}>{new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:28}}>
        {kpis.map(k=>(
          <div key={k.label} style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.radiusLg,padding:"20px 22px",position:"relative",overflow:"hidden",boxShadow:`0 2px 8px ${T.shadow}`}}>
            <div style={{position:"absolute",top:0,left:0,width:4,height:"100%",background:k.color,borderRadius:"8px 0 0 8px"}}/>
            <div style={{paddingLeft:8}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                <div style={{fontSize:10,color:T.textDim,fontFamily:T.mono,letterSpacing:1.5,textTransform:"uppercase",fontWeight:600}}>{k.label}</div>
                <div style={{width:28,height:28,borderRadius:"50%",background:k.color+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:k.color}}>{k.icon}</div>
              </div>
              <div style={{fontSize:28,fontWeight:700,color:T.text,letterSpacing:-0.5}}>{k.value}</div>
              <div style={{fontSize:12,color:T.textMid,marginTop:4,fontWeight:400}}>{k.sub}</div>
            </div>
          </div>
        ))}
      </div>
      {(lowStock.length>0||outOfStock.length>0)&&(
        <div style={{background:T.redDim,border:`1px solid ${T.red}44`,borderRadius:T.radius,padding:"14px 20px",marginBottom:24,display:"flex",alignItems:"flex-start",gap:14}}>
          <div style={{fontSize:18,color:T.red,flexShrink:0}}>⚠</div>
          <div>
            <div style={{fontSize:12,fontWeight:700,color:T.red,marginBottom:8}}>Stock Alerts</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {outOfStock.map(i=><Chip key={i.id} color={T.red}>{i.name}: OUT OF STOCK</Chip>)}
              {lowStock.map(i=><Chip key={i.id} color={T.amber}>{i.name}: {i.qty} left</Chip>)}
            </div>
          </div>
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
        {[{title:"Recent RFPs",items:store.rfps.slice(0,6),render:r=>{const v=store.vendors.find(vv=>vv.id===r.vendorId);return(<div key={r.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:`1px solid ${T.border}`}}><span style={{fontSize:13,color:T.text,fontWeight:500}}>{v?.name||"Unknown"}</span><SBadge status={r.status}/></div>);},empty:"No RFPs yet"},{title:"Recent Invoices",items:store.invoices.slice(0,6),render:inv=>{const c=store.clients.find(cc=>cc.id===inv.clientId);return(<div key={inv.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:`1px solid ${T.border}`}}><span style={{fontSize:13,color:T.text,fontWeight:500}}>{c?.name||"Unknown"}</span><div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:13,fontWeight:700,color:T.accent,fontFamily:T.mono}}>${inv.total.toFixed(2)}</span><SBadge status={inv.status}/></div></div>);},empty:"No invoices yet"}].map(panel=>(
          <div key={panel.title} style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.radiusLg,padding:22,boxShadow:`0 2px 8px ${T.shadow}`}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
              <div style={{fontSize:12,color:T.text,fontWeight:600}}>{panel.title}</div>
              <div style={{fontSize:10,color:T.textDim,fontFamily:T.mono}}>{panel.items.length} records</div>
            </div>
            {panel.items.length?panel.items.map(panel.render):<div style={{fontSize:13,color:T.textMid,padding:"20px 0",textAlign:"center"}}>{panel.empty}</div>}
          </div>
        ))}
      </div>
      {!store.vendors.length&&!store.inventory.length&&(
        <div style={{marginTop:24,background:T.accentDim,border:`1px solid ${T.borderHi}`,borderRadius:T.radiusLg,padding:"20px 24px"}}>
          <div style={{fontSize:11,color:T.accent,fontFamily:T.mono,letterSpacing:2,marginBottom:10,fontWeight:700}}>GETTING STARTED</div>
          <div style={{fontSize:13,color:T.textMid,lineHeight:1.7}}>
            1. Add <strong style={{color:T.accent}}>Vendors</strong> and upload their pricing sheets (AI-powered) → 2. Create <strong style={{color:T.accent}}>RFPs</strong> to request quotes → 3. Add <strong style={{color:T.accent}}>Inventory</strong> items → 4. Add <strong style={{color:T.accent}}>Clients</strong> and create <strong style={{color:T.accent}}>Invoices</strong>
          </div>
        </div>
      )}
    </div>
  );
}

function PricingSection({vendor,update,showToast,log}){
  const [mode,setMode]=useState("list");
  const [preview,setPreview]=useState([]);
  const [np,setNp]=useState({name:"",sku:"",price:"",strength:""});
  const [editId,setEditId]=useState(null);
  const [editBuf,setEditBuf]=useState({});
  const [drag,setDrag]=useState(false);
  const [parsing,setParsing]=useState(false);
  const products=vendor.products||[];

  // Parse Excel/CSV files directly in the browser — no AI needed, instant and reliable
  async function parseExcel(file){
    return new Promise((resolve)=>{
      const reader=new FileReader();
      reader.onload=ev=>{
        try{
          const XLSX=window.XLSX;
          if(!XLSX){resolve([]);return;}
          const data=new Uint8Array(ev.target.result);
          const wb=XLSX.read(data,{type:"array"});
          const ws=wb.Sheets[wb.SheetNames[0]];
          const rows=XLSX.utils.sheet_to_json(ws,{defval:""});
          if(!rows.length){resolve([]);return;}
          // Auto-detect columns by trying common header names
          const keys=Object.keys(rows[0]).map(k=>k.toLowerCase());
          const findCol=(names)=>Object.keys(rows[0]).find(k=>names.some(n=>k.toLowerCase().includes(n)))||"";
          const nameCol=findCol(["product_name","product","name","item","description","peptide"]);
          const skuCol=findCol(["sku","code","abbreviation","abbr","catalog","id"]);
          const priceCol=findCol(["price_usd","price","cost","rate","unit_price","price_per"]);
          const strengthCol=findCol(["specification","spec","strength","size","dosage","package"]);
          // Clean strength: "10mg*10vials" → "10mg", strip package/vial info
          const cleanStrength=(s)=>{
            if(!s)return"";
            const str=String(s).trim();
            // Split on * or x and take only the dosage part (first part)
            const parts=str.split(/[*xX]/);
            if(parts.length>1){
              // First part is dosage (e.g. "10mg"), ignore vials/package part
              return parts[0].trim();
            }
            // Also strip trailing vial/pack info like "10vials", "5ml vials"
            return str.replace(/\s*\*?\s*\d+\s*vials?/i,"").replace(/\s*\*?\s*\d+\s*amps?/i,"").trim();
          };
          const products=rows.map(r=>{
            const pName=String(r[nameCol]||"").trim();
            const pStrength=cleanStrength(r[strengthCol]);
            const fullName=pName&&pStrength?pName+" - "+pStrength:pName;
            return{
              name:fullName,
              sku:String(r[skuCol]||"").trim(),
              price:parseFloat(String(r[priceCol]||"0").replace(/[^0-9.]/g,""))||0,
              strength:pStrength
            };
          }).filter(p=>p.name&&p.name!=="undefined");
          resolve(products);
        }catch(e){console.error("Excel parse error:",e);resolve([]);}
      };
      reader.onerror=()=>resolve([]);
      reader.readAsArrayBuffer(file);
    });
  }

  async function parseCSV(file){
    return new Promise((resolve)=>{
      const reader=new FileReader();
      reader.onload=ev=>{
        try{
          const text=ev.target.result;
          const lines=text.split("\n").filter(l=>l.trim());
          if(lines.length<2){resolve([]);return;}
          const headers=lines[0].split(",").map(h=>h.replace(/"/g,"").trim().toLowerCase());
          const findIdx=(names)=>headers.findIndex(h=>names.some(n=>h.includes(n)));
          const nameIdx=findIdx(["product_name","product","name","item","description"]);
          const skuIdx=findIdx(["sku","code","abbr","catalog","id"]);
          const priceIdx=findIdx(["price","cost","rate","usd"]);
          const strengthIdx=findIdx(["spec","strength","size","dosage","package"]);
          const products=lines.slice(1).map(line=>{
            const cols=line.split(",").map(c=>c.replace(/"/g,"").trim());
            const rawStr=strengthIdx>=0?cols[strengthIdx]||"":"";
            const cleanedStr=rawStr.split(/[*xX]/)[0].trim().replace(/\s*\d+\s*vials?/i,"").trim();
            const csvName=nameIdx>=0?cols[nameIdx]||"":"";
            const fullCsvName=csvName&&cleanedStr?csvName+" - "+cleanedStr:csvName;
            return{
              name:fullCsvName,
              sku:skuIdx>=0?cols[skuIdx]||"":"",
              price:priceIdx>=0?parseFloat(cols[priceIdx])||0:0,
              strength:cleanedStr
            };
          }).filter(p=>p.name);
          resolve(products);
        }catch(e){resolve([]);}
      };
      reader.onerror=()=>resolve([]);
      reader.readAsText(file);
    });
  }

  async function runParse(file){
    if(file.size>20*1024*1024){showToast("File too large — max 20MB",T.amber);return;}
    setParsing(true);setMode("list");
    const ext=file.name.split(".").pop().toLowerCase();
    const isExcel=["xlsx","xls","xlsm"].includes(ext);
    const isCSV=ext==="csv";
    const isPDF=file.type==="application/pdf"||ext==="pdf";
    const isImage=file.type.startsWith("image/")||["png","jpg","jpeg","webp"].includes(ext);

    try{
      if(isExcel){
        showToast("Reading Excel file...",T.accent);
        // Load SheetJS dynamically if not present
        if(!window.XLSX){
          await new Promise((res,rej)=>{
            const s=document.createElement("script");
            s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
            s.onload=res;s.onerror=rej;
            document.head.appendChild(s);
          });
        }
        const products=await parseExcel(file);
        if(products.length>0){
          setPreview(products.map(p=>({...p,_id:uid(),_keep:true})));
          setMode("preview");
          showToast("Found "+products.length+" products from Excel!",T.green);
        }else{
          showToast("Could not read Excel — check column headers",T.amber);
        }
      }else if(isCSV){
        showToast("Reading CSV file...",T.accent);
        const products=await parseCSV(file);
        if(products.length>0){
          setPreview(products.map(p=>({...p,_id:uid(),_keep:true})));
          setMode("preview");
          showToast("Found "+products.length+" products from CSV!",T.green);
        }else{
          showToast("Could not read CSV — check column headers",T.amber);
        }
      }else if(isPDF||isImage){
        showToast("Sending to AI for reading...",T.accent);
        const b64=await new Promise((resolve,reject)=>{
          const reader=new FileReader();
          reader.onload=ev=>resolve(ev.target.result.split(",")[1]);
          reader.onerror=()=>reject(new Error("Failed to read file"));
          reader.readAsDataURL(file);
        });
        const fileType=isPDF?"application/pdf":file.type||"image/png";
        const parsed=await parseFileWithClaude(b64,fileType);
        if(Array.isArray(parsed)&&parsed.length>0){
          setPreview(parsed.map(p=>({...p,_id:uid(),_keep:true})));
          setMode("preview");
          showToast("Found "+parsed.length+" products!",T.purple);
        }else{
          showToast("AI could not read file. Try uploading as Excel or CSV instead.",T.amber);
        }
      }else{
        showToast("Unsupported file type. Use Excel, CSV, PDF or image.",T.amber);
      }
    }catch(err){
      console.error("Parse error:",err);
      showToast("Error reading file: "+err.message,T.red);
    }finally{
      setParsing(false);
    }
  }

  function commitPreview(){
    const toAdd=preview.filter(p=>p._keep).map(({_id,_keep,...p})=>({...p,id:uid(),price:parseFloat(p.price)||0}));
    update(s=>{
      s.vendors=s.vendors.map(v=>v.id===vendor.id?{...v,products:[...(v.products||[]),...toAdd]}:v);
      return s;
    });
    log("Imported "+toAdd.length+" products to "+vendor.name);showToast("✓ "+toAdd.length+" products added");setPreview([]);setMode("list");
  }
  function saveManual(){
    if(!np.name.trim())return;
    const newProd={id:uid(),name:np.name.trim(),sku:np.sku.trim(),price:parseFloat(np.price)||0,strength:np.strength.trim()};
    update(s=>{
      s.vendors=s.vendors.map(v=>v.id===vendor.id?{...v,products:[...(v.products||[]),newProd]}:v);
      return s;
    });
    showToast("Product added");setNp({name:"",sku:"",price:"",strength:""});
  }
  function delProd(pid){update(s=>{s.vendors=s.vendors.map(v=>v.id===vendor.id?{...v,products:(v.products||[]).filter(p=>p.id!==pid)}:v);return s;});}
  function startEdit(p){setEditId(p.id);setEditBuf({name:p.name,sku:p.sku||"",price:p.price||0,strength:p.strength||""});}
  function saveEdit(pid){update(s=>{s.vendors=s.vendors.map(v=>v.id===vendor.id?{...v,products:(v.products||[]).map(p=>p.id===pid?{...p,...editBuf,price:parseFloat(editBuf.price)||0}:p)}:v);return s;});setEditId(null);}
  const th={textAlign:"left",padding:"7px 10px",fontSize:11,color:T.textMid,fontFamily:T.mono,borderBottom:`1px solid ${T.border}`,fontWeight:600};
  const td={padding:"8px 10px",fontSize:13,verticalAlign:"middle"};

  return(
    <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,marginBottom:16,overflow:"hidden"}}>
      <div style={{padding:"16px 20px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:13,color:T.textMid,fontFamily:T.mono,letterSpacing:1,fontWeight:600}}>PRICING CATALOG {products.length>0&&<span style={{color:T.textDim,fontWeight:400}}>· {products.length} items</span>}</span>
        <div style={{display:"flex",gap:8}}>
          {["list","upload","manual"].map(m=>(
            <button key={m} onClick={()=>setMode(m===mode&&m!=="list"?"list":m)} style={{background:mode===m?T.accentDim:"transparent",border:`1px solid ${T.borderHi}`,color:mode===m?T.accent:T.textMid,borderRadius:6,padding:"5px 12px",cursor:"pointer",fontSize:12,fontFamily:T.font,fontWeight:600}}>
              {m==="list"?"All":m==="upload"?"⬆ Upload":"+ Manual"}
            </button>
          ))}
        </div>
      </div>

      {mode==="upload"&&(
        <div style={{padding:20}}>
          <div onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files[0];if(f)runParse(f);}} onClick={()=>{const i=document.createElement("input");i.type="file";i.accept=".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp";i.onchange=e=>{const f=e.target.files[0];if(f)runParse(f);};i.click();}} style={{border:`2px dashed ${drag?T.accent:T.borderHi}`,borderRadius:8,padding:"36px 24px",textAlign:"center",cursor:"pointer",background:drag?T.bgCard:T.bg}}>
            <div style={{fontSize:28,marginBottom:10}}>⬆</div>
            <div style={{fontSize:14,color:T.text,marginBottom:6,fontWeight:600}}>Drop your pricing document here</div>
            <div style={{fontSize:12,color:T.textMid}}>Excel · CSV · PDF · PNG · JPG</div>
            <div style={{fontSize:11,color:T.green,marginTop:6,fontWeight:600}}>✓ Excel & CSV import instantly — no AI needed</div>
          </div>
          {parsing&&<div style={{marginTop:14,background:T.bgCard,border:`1px solid ${T.borderHi}`,borderRadius:6,padding:"12px 16px",display:"flex",alignItems:"center",gap:12}}><div style={{width:16,height:16,border:"2px solid #7c9be0",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/><span style={{fontSize:13,color:T.purple,fontWeight:500}}>AI is reading your pricing sheet...</span></div>}
        </div>
      )}

      {mode==="preview"&&(
        <div style={{padding:20}}>
          <div style={{background:T.greenDim,border:`1px solid ${T.green}44`,borderRadius:6,padding:"10px 14px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:13,color:T.green,fontWeight:600}}>✓ Found {preview.length} products — review then import</span>
            <div style={{display:"flex",gap:8}}><Btn small onClick={commitPreview}>Import {preview.filter(p=>p._keep).length}</Btn><Btn small ghost onClick={()=>{setPreview([]);setMode("list");}}>Cancel</Btn></div>
          </div>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr><th style={th}></th>{["Product Name","SKU","Price","Strength"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{preview.map((p,i)=>(
              <tr key={p._id} style={{opacity:p._keep?1:0.4}}>
                <td style={{...td,textAlign:"center"}}><input type="checkbox" checked={p._keep} onChange={e=>setPreview(prev=>prev.map((pp,j)=>j===i?{...pp,_keep:e.target.checked}:pp))}/></td>
                {["name","sku","price","strength"].map(f=><td key={f} style={td}><input value={f==="price"?p[f]:(p[f]||"")} type={f==="price"?"number":"text"} onChange={e=>setPreview(prev=>prev.map((pp,j)=>j===i?{...pp,[f]:e.target.value}:pp))} style={{...IS,padding:"4px 8px",fontSize:12}}/></td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {mode==="manual"&&(
        <div style={{padding:20,borderBottom:`1px solid ${T.border}`}}>
          <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr auto",gap:10,alignItems:"end"}}>
            {[{k:"name",l:"Product Name",ph:"e.g. Nitrile Gloves"},{k:"sku",l:"SKU",ph:"SKU-001"},{k:"price",l:"Unit Price ($)",ph:"0.00",t:"number"},{k:"strength",l:"Strength/Size",ph:"500mg"}].map(col=>(
              <div key={col.k}><Lbl>{col.l}</Lbl><input type={col.t||"text"} value={np[col.k]} placeholder={col.ph} onChange={e=>setNp(p=>({...p,[col.k]:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&saveManual()} style={{...IS,padding:"7px 10px"}}/></div>
            ))}
            <div><Btn onClick={saveManual}>Add</Btn></div>
          </div>
        </div>
      )}

      {(mode==="list"||mode==="manual")&&(
        products.length>0?(
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>{["Product Name","SKU","Unit Price","Strength",""].map(h=><th key={h} style={{...th,paddingLeft:h==="Product Name"?20:10}}>{h}</th>)}</tr></thead>
            <tbody>{products.map(p=>(
              <tr key={p.id} style={{borderBottom:`1px solid ${T.border}`}}>
                {editId===p.id?(
                  <>{["name","sku","price","strength"].map(f=><td key={f} style={{...td,paddingLeft:f==="name"?20:10}}><input type={f==="price"?"number":"text"} value={editBuf[f]} onChange={e=>setEditBuf(b=>({...b,[f]:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&saveEdit(p.id)} style={{...IS,padding:"4px 8px",fontSize:12}} autoFocus={f==="name"}/></td>)}
                  <td style={{...td,display:"flex",gap:6}}><Btn small onClick={()=>saveEdit(p.id)}>✓</Btn><Btn small ghost onClick={()=>setEditId(null)}>✕</Btn></td></>
                ):(
                  <><td style={{...td,color:T.text,paddingLeft:20,fontWeight:500}}>{p.name}</td>
                  <td style={{...td,color:T.textMid,fontFamily:T.mono,fontSize:12}}>{p.sku||"—"}</td>
                  <td style={{...td,color:T.accent,fontWeight:700}}>${parseFloat(p.price||0).toFixed(2)}</td>
                  <td style={{...td,color:T.textMid,fontSize:12}}>{p.strength||"—"}</td>
                  <td style={{...td,display:"flex",gap:6,alignItems:"center"}}>
                    <button onClick={()=>startEdit(p)} style={{background:"none",border:"none",color:T.textMid,cursor:"pointer",fontSize:13}}>✎</button>
                    <button onClick={()=>delProd(p.id)} style={{background:"none",border:"none",color:T.textMid,cursor:"pointer",fontSize:14}}>✕</button>
                  </td></>
                )}
              </tr>
            ))}</tbody>
          </table>
        ):mode!=="manual"&&(
          <div style={{padding:"40px 20px",textAlign:"center"}}>
            <div style={{fontSize:24,marginBottom:12,color:T.textDim}}>◈</div>
            <div style={{fontSize:14,color:T.textMid,fontWeight:500,marginBottom:6}}>No pricing catalog yet</div>
            <div style={{display:"flex",gap:10,justifyContent:"center",marginTop:16}}>
              <Btn onClick={()=>setMode("upload")}>⬆ Upload Sheet</Btn>
              <Btn ghost onClick={()=>setMode("manual")}>+ Add Manually</Btn>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function VendorForm({initial,onSave,onCancel}){
  const [f,setF]=useState({name:"",contactName:"",contactTitle:"",contactPhone:"",email:"",businessNumber:"",industry:"",website:"",address:"",city:"",state:"",zip:"",country:"US",paymentTerms:"",preferredContact:"",notes:"",...initial});
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  const {pct,tier}=vendorCompleteness(f);const tc=getTIER()[tier];const circ=113,off=circ-(circ*pct/100);
  return(
    <div style={{maxWidth:640}}>
      <div style={{fontSize:10,color:T.accent,fontFamily:T.mono,letterSpacing:3,marginBottom:6,textTransform:"uppercase"}}>Vendor Management</div>
      <h2 style={{fontSize:22,fontWeight:700,color:T.text,marginBottom:22}}>{initial?.id?"Edit Vendor":"New Vendor"}</h2>
      <div style={{background:T.bgCard,border:`1px solid ${tc.border}`,borderRadius:T.radius,padding:"14px 20px",display:"flex",alignItems:"center",gap:16,marginBottom:24}}>
        <div style={{position:"relative",width:44,height:44,flexShrink:0}}>
          <svg width="44" height="44" viewBox="0 0 44 44" style={{transform:"rotate(-90deg)"}}>
            <circle cx="22" cy="22" r="18" fill="none" stroke={T.border} strokeWidth="3.5"/>
            <circle cx="22" cy="22" r="18" fill="none" stroke={tc.text} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off}/>
          </svg>
          <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:tc.text,fontFamily:T.mono}}>{pct}%</div>
        </div>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:2}}>Profile completeness</div>
          <div style={{fontSize:11,color:T.textMid}}>{pct>=75?"Well documented — great for RFPs":pct>=35?"A few more fields will help":"Add details to improve vendor records"}</div>
        </div>
        <div style={{background:tc.bg,border:`1px solid ${tc.border}`,color:tc.text,borderRadius:20,padding:"4px 14px",fontSize:11,fontWeight:700}}>{tier}</div>
      </div>
      {[["Business Info",[{span:true,k:"name",l:"Business Name",req:true,ph:"e.g. Sunrise Medical Supply"},{k:"businessNumber",l:"Business/Tax #",ph:"EIN/Tax ID"},{k:"industry",l:"Industry",sel:INDUSTRIES},{k:"website",l:"Website",ph:"https://"},{k:"paymentTerms",l:"Payment Terms",sel:PAYMENT_TERMS}]],["Primary Contact",[{k:"contactName",l:"Contact Name",ph:"First & last"},{k:"contactTitle",l:"Title/Role",ph:"e.g. Account Manager"},{k:"contactPhone",l:"Phone",ph:"(555) 000-0000"},{k:"email",l:"Email",ph:"vendor@company.com"},{k:"preferredContact",l:"Preferred Contact",sel:["Email","Phone","Both"]}]],["Business Address",[{span:true,k:"address",l:"Street Address",ph:"123 Commerce Blvd"},{k:"country",l:"Country",ctry:true},{k:"city",l:"City",ph:"City"},{k:"zip",l:"ZIP / Postal",ph:"00000"}]]].map(([section,fields])=>(
        <div key={section}>
          <div style={{fontSize:10,color:T.accent,fontFamily:T.mono,letterSpacing:2,textTransform:"uppercase",margin:"24px 0 14px",display:"flex",alignItems:"center",gap:10}}>{section}<div style={{flex:1,height:1,background:`linear-gradient(90deg,${T.border},transparent)`}}/></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            {fields.map(field=>(
              <div key={field.k} style={field.span?{gridColumn:"1/-1"}:{}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:T.textMid,fontFamily:T.mono,letterSpacing:1,marginBottom:6,fontWeight:700,textTransform:"uppercase"}}>
                  <span>{field.l}{field.req&&<span style={{color:T.red,marginLeft:3}}>*</span>}</span>
                </div>
                {field.ctry?<select value={f.country} onChange={e=>set("country",e.target.value)} style={IS}><option value="">Select...</option>{COUNTRIES.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}</select>
                :field.sel?<select value={f[field.k]} onChange={e=>set(field.k,e.target.value)} style={IS}><option value="">Select...</option>{field.sel.map(o=><option key={o}>{o}</option>)}</select>
                :<input value={f[field.k]||""} onChange={e=>set(field.k,e.target.value)} style={{...IS,borderColor:field.req&&!f[field.k]?.trim()?T.red+"66":T.border}} placeholder={field.ph}/>}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div style={{fontSize:10,color:T.accent,fontFamily:T.mono,letterSpacing:2,textTransform:"uppercase",margin:"24px 0 8px",fontWeight:700}}>Notes</div>
      <textarea value={f.notes} onChange={e=>set("notes",e.target.value)} style={{...IS,height:90,resize:"vertical"}} placeholder="Payment terms, lead times..."/>
      <div style={{display:"flex",gap:10,marginTop:22}}><Btn onClick={()=>{if(!f.name.trim()){alert("Business name required");return;}onSave(f);}}>Save Vendor</Btn><Btn ghost onClick={onCancel}>Cancel</Btn></div>
    </div>
  );
}

function Vendors({store,update,log,showToast}){
  const [sel,setSel]=useState(null);const [form,setForm]=useState(null);const [search,setSearch]=useState("");
  const vendor=sel?store.vendors.find(v=>v.id===sel):null;
  const filtered=store.vendors.filter(v=>v.name.toLowerCase().includes(search.toLowerCase()));
  function save(data){
    const isNew=!data.id;
    if(isNew){data={...data,id:uid(),createdAt:now(),products:[]};}
    update(s=>{
      if(!isNew)s.vendors=s.vendors.map(v=>v.id===data.id?{...v,...data}:v);
      else s.vendors=[...s.vendors,data];
      return s;
    });
    log("Vendor "+data.name+" saved");showToast("Vendor saved");setForm(null);setSel(data.id);
  }
  function del(id){if(!confirm("Delete this vendor?"))return;update(s=>{s.vendors=s.vendors.filter(v=>v.id!==id);return s;});log("Vendor deleted","warn");setSel(null);}
  const vRFPs=vendor?store.rfps.filter(r=>r.vendorId===vendor.id):[];
  const vSavings=vRFPs.reduce((s,r)=>s+parseFloat(r.savings||0),0);
  const vSpend=vRFPs.filter(r=>r.vendorTotal).reduce((s,r)=>s+parseFloat(r.vendorTotal||0),0);
  return(
    <div style={{display:"flex",height:"100%",overflow:"hidden"}}>
      <div style={{width:260,borderRight:`1px solid ${T.border}`,overflow:"auto",padding:20,flexShrink:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><div><div style={{fontSize:10,color:T.textDim,fontFamily:T.mono,letterSpacing:1.5,textTransform:"uppercase",fontWeight:600,marginBottom:2}}>Directory</div><h3 style={{margin:0,fontSize:15,color:T.text,fontWeight:600}}>Vendors</h3></div><Btn small onClick={()=>{setForm({});setSel(null);}}>+ New Vendor</Btn></div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search vendors..." style={{...IS,marginBottom:8}}/>
        <div style={{fontSize:11,color:T.textMid,marginBottom:12,fontWeight:500}}>{filtered.length} vendor{filtered.length!==1?"s":""}</div>
        {filtered.map(v=>{const {tier}=vendorCompleteness(v);const tc=getTIER()[tier];return(
          <div key={v.id} style={{marginBottom:4}}>
            <div onClick={()=>{setSel(v.id);setForm(null);}} style={{padding:"10px 12px",borderRadius:6,cursor:"pointer",background:sel===v.id?T.bgPanel:"transparent",border:sel===v.id?`1px solid ${T.borderHi}`:"1px solid transparent"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:30,height:30,borderRadius:"50%",background:T.bgCard,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:T.purple,flexShrink:0}}>{vendorInitials(v.name)}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,color:sel===v.id?T.accent:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:600}}>{v.name}</div>
                  <div style={{fontSize:10,color:T.textMid,fontFamily:T.mono}}>{(v.products||[]).length} products</div>
                </div>
                <div style={{width:6,height:6,borderRadius:"50%",background:tc.text,flexShrink:0}}/>
              </div>
              <div style={{display:"flex",gap:4,marginTop:6}}>
                <button onClick={e=>{e.stopPropagation();setSel(v.id);setForm({...v});}} style={{fontSize:10,padding:"2px 8px",borderRadius:4,border:`1px solid ${T.border}`,background:"transparent",color:T.textMid,cursor:"pointer",fontFamily:T.font}}>Edit</button>
                <button onClick={e=>{e.stopPropagation();if(!confirm("Delete "+v.name+" and all their products?"))return;update(s=>{s.vendors=s.vendors.filter(vv=>vv.id!==v.id);return s;});if(sel===v.id)setSel(null);}} style={{fontSize:10,padding:"2px 8px",borderRadius:4,border:`1px solid ${T.red}44`,background:"transparent",color:T.red,cursor:"pointer",fontFamily:T.font}}>Delete</button>
              </div>
            </div>
          </div>
        );})}
        {!filtered.length&&<div style={{color:T.textMid,fontSize:12,marginTop:16,textAlign:"center"}}>No vendors yet</div>}
      </div>
      <div style={{flex:1,overflow:"auto",padding:"32px 36px"}}>
        {!vendor&&!form&&<div style={{textAlign:"center",marginTop:80}}><div style={{fontSize:32,marginBottom:12}}>⬡</div><div style={{color:T.textMid,fontSize:14,fontWeight:500}}>Select a vendor or create a new one</div></div>}
        {form&&<VendorForm initial={form} onSave={data=>save(form.id?{...form,...data}:{...data})} onCancel={()=>setForm(null)}/>}
        {vendor&&!form&&(()=>{
          const {pct,tier}=vendorCompleteness(vendor);const tc=getTIER()[tier];
          return(<>
            <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:10,marginBottom:20,overflow:"hidden"}}>
              <div style={{padding:"20px 24px",display:"flex",gap:16,alignItems:"flex-start",borderBottom:`1px solid ${T.border}`}}>
                <div style={{width:54,height:54,borderRadius:"50%",background:T.bgPanel,display:"flex",alignItems:"center",justifyContent:"center",fontSize:19,fontWeight:700,color:T.purple,flexShrink:0}}>{vendorInitials(vendor.name)}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:22,fontWeight:700,color:T.text}}>{vendor.name}</div>
                  <div style={{fontSize:12,color:T.textMid,marginTop:3,fontWeight:500}}>{[vendor.industry,vendor.paymentTerms].filter(Boolean).join(" · ")}</div>
                  <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
                    <div style={{background:tc.bg,border:`1px solid ${tc.border}`,color:tc.text,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700}}>{tier} · {pct}%</div>
                    <div style={{background:T.bgPanel,border:`1px solid ${T.borderHi}`,color:T.textMid,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:600}}>{(vendor.products||[]).length} products</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:8}}><Btn small onClick={()=>setForm({...vendor})}>Edit</Btn><Btn small danger onClick={()=>del(vendor.id)}>Delete</Btn></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)"}}>
                {[{label:"Total Spend",val:`$${vSpend.toFixed(2)}`},{label:"Total Saved",val:`$${vSavings.toFixed(2)}`},{label:"RFPs",val:vRFPs.length}].map((s,i)=>(
                  <div key={s.label} style={{padding:"14px 20px",textAlign:"center",borderRight:i<2?`1px solid ${T.border}`:"none"}}>
                    <div style={{fontSize:18,fontWeight:700,color:T.accent}}>{s.val}</div>
                    <div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,marginTop:3,fontWeight:600}}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
              <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,padding:18}}>
                <div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,letterSpacing:1,marginBottom:14,fontWeight:700}}>PRIMARY CONTACT</div>
                {[["Name",vendor.contactName],["Title",vendor.contactTitle],["Phone",vendor.contactPhone],["Email",vendor.email],["Business #",vendor.businessNumber]].map(([l,v])=>(
                  <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${T.border}`}}>
                    <span style={{fontSize:11,color:T.textMid,fontFamily:T.mono,fontWeight:600}}>{l}</span>
                    <span style={{fontSize:12,color:v?T.text:T.textDim,fontStyle:v?"normal":"italic",fontWeight:v?500:400}}>{v||"—"}</span>
                  </div>
                ))}
              </div>
              <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,padding:18}}>
                <div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,letterSpacing:1,marginBottom:14,fontWeight:700}}>ADDRESS</div>
                {vendor.address?<div style={{fontSize:13,color:T.text,lineHeight:1.8,fontWeight:500}}><div>{vendor.address}</div>{(vendor.city||vendor.state)&&<div>{[vendor.city,vendor.state].filter(Boolean).join(", ")}{vendor.zip?` ${vendor.zip}`:""}</div>}</div>:<div style={{fontSize:13,color:T.textMid,fontStyle:"italic"}}>No address on file</div>}
                {vendor.website&&<a href={vendor.website} target="_blank" rel="noreferrer" style={{color:T.purple,fontSize:12,display:"block",marginTop:10,fontWeight:500}}>{vendor.website}</a>}
              </div>
            </div>
            <PricingSection vendor={vendor} update={update} showToast={showToast} log={log}/>
            {vendor.notes&&<div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,padding:18}}><div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,letterSpacing:1,marginBottom:8,fontWeight:700}}>NOTES</div><div style={{fontSize:13,color:T.text,lineHeight:1.7,whiteSpace:"pre-wrap",fontWeight:400}}>{vendor.notes}</div></div>}
          </>);
        })()}
      </div>
    </div>
  );
}

// ── PDF Export for Quote Request Form ────────────────────────────────────────
function downloadRFPpdf(rfp, vendor, companyNotes, company) {
  const co = company || { name: "Pura Research Labs LLC", email: "phil@puraresearchlabs.com", phone: "+1-239-506-3434", address: "1242 SW Pine Island Rd, Suite 42-291, Cape Coral, FL 33991 USA" };
  const date = new Date(rfp.createdAt).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});
  const refNum = rfp.id.slice(0,8).toUpperCase();

  // Build table rows — NO pricing, just product info and qty
  const rows = rfp.lines.map((l,i) =>
    `<tr style="background:${i%2===0?"#f8fafc":"#ffffff"}">
      <td style="padding:11px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#1a202c;font-weight:500">${l.productName}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#4a5568">${l.strength||"—"}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#1a202c;text-align:center;font-weight:600">${l.qty}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#4a5568;text-align:center">${l.vials||10} vials/kit</td>
      <td style="padding:11px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#718096;text-align:right">$____________</td>
      <td style="padding:11px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#718096;text-align:right">$____________</td>
    </tr>`
  ).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Segoe UI',Arial,sans-serif;color:#1a202c;background:#fff;}
    @page{margin:15mm 18mm;}
    @media print{body{padding:0;}}
    table{border-spacing:0;}
  </style></head><body>

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#1a365d 0%,#2b6cb0 100%);padding:24px 32px;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="display:flex;align-items:center;margin-bottom:10px;">
          <div style="width:32px;height:32px;background:rgba(255,255,255,0.2);border-radius:7px;display:inline-flex;align-items:center;justify-content:center;margin-right:10px;">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M10 2L10 18M2 10L18 10" stroke="white" stroke-width="2.5" stroke-linecap="round"/><circle cx="10" cy="10" r="3" fill="white"/></svg>
          </div>
          <span style="font-size:18px;font-weight:700;color:white;letter-spacing:0.5px;">INVTRACK</span>
          <span style="font-size:10px;color:rgba(255,255,255,0.55);margin-left:8px;letter-spacing:2px;">MEDICAL PRO</span>
        </div>
        <div style="font-size:26px;font-weight:700;color:white;">Quote Request Form</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:3px;">Official Procurement Document — Confidential</div>
      </div>
      <div style="text-align:right;background:rgba(255,255,255,0.15);border-radius:8px;padding:14px 18px;">
        <div style="font-size:9px;color:rgba(255,255,255,0.55);letter-spacing:2px;margin-bottom:3px;">REFERENCE NO.</div>
        <div style="font-size:18px;font-weight:700;color:white;font-family:monospace;">#${refNum}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.65);margin-top:4px;">${date}</div>
      </div>
    </div>
  </div>

  <!-- Status Bar -->
  <div style="background:#ebf4ff;border-bottom:2px solid #bee3f8;padding:9px 32px;display:flex;gap:28px;align-items:center;">
    <div><span style="font-size:9px;color:#2c5282;letter-spacing:1px;font-weight:700;">STATUS</span>
      <span style="margin-left:8px;background:#2b6cb0;color:white;border-radius:10px;padding:2px 9px;font-size:10px;font-weight:600;">${rfp.status}</span></div>
    <div><span style="font-size:9px;color:#2c5282;letter-spacing:1px;font-weight:700;">ITEMS</span>
      <span style="margin-left:6px;font-size:12px;color:#2d3748;font-weight:600;">${rfp.lines.length}</span></div>
    <div><span style="font-size:9px;color:#2c5282;letter-spacing:1px;font-weight:700;">DATE</span>
      <span style="margin-left:6px;font-size:12px;color:#2d3748;font-weight:600;">${date}</span></div>
  </div>

  <!-- Vendor & From Info -->
  <div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #e2e8f0;">
    <div style="padding:18px 32px;border-right:1px solid #e2e8f0;">
      <div style="font-size:9px;color:#718096;letter-spacing:2px;font-weight:700;margin-bottom:8px;">QUOTE REQUESTED FROM</div>
      <div style="font-size:16px;font-weight:700;color:#1a202c;margin-bottom:3px;">${vendor?.name||"Vendor"}</div>
      ${vendor?.contactName?`<div style="font-size:12px;color:#4a5568;margin-bottom:1px;">Attn: ${vendor.contactName}${vendor.contactTitle?" · "+vendor.contactTitle:""}</div>`:""}
      ${vendor?.email?`<div style="font-size:12px;color:#2b6cb0;">${vendor.email}</div>`:""}
      ${vendor?.contactPhone?`<div style="font-size:12px;color:#4a5568;">${vendor.contactPhone}</div>`:""}
    </div>
    <div style="padding:18px 32px;">
      <div style="font-size:9px;color:#718096;letter-spacing:2px;font-weight:700;margin-bottom:8px;">REQUESTED BY</div>
      <div style="font-size:14px;font-weight:700;color:#1a202c;margin-bottom:3px;">${co.name}</div>
      ${co.email?`<div style="font-size:12px;color:#2b6cb0;margin-bottom:2px;">${co.email}</div>`:""}
      ${co.phone?`<div style="font-size:12px;color:#4a5568;margin-bottom:2px;">${co.phone}</div>`:""}
      ${co.address?`<div style="font-size:12px;color:#4a5568;margin-bottom:2px;">${co.address}</div>`:""}
      <div style="font-size:12px;color:#4a5568;margin-top:4px;">Date Issued: ${date}</div>
      <div style="font-size:12px;color:#4a5568;margin-top:2px;">Quote valid for: 30 days</div>
      ${rfp.dueDate?`<div style="font-size:12px;color:#c53030;font-weight:600;margin-top:3px;">Please respond by: ${rfp.dueDate}</div>`:""}
    </div>
  </div>

  <!-- Line Items Table — NO PRICES -->
  <div style="padding:20px 32px 0;">
    <div style="font-size:10px;color:#718096;letter-spacing:2px;font-weight:700;margin-bottom:10px;">REQUESTED ITEMS</div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;overflow:hidden;">
      <thead>
        <tr style="background:#2b6cb0;">
          <th style="padding:10px 14px;text-align:left;font-size:11px;color:white;font-weight:600;letter-spacing:0.3px;">PRODUCT NAME</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;color:white;font-weight:600;">STRENGTH</th>
          <th style="padding:10px 14px;text-align:center;font-size:11px;color:white;font-weight:600;">QTY</th>
          <th style="padding:10px 14px;text-align:center;font-size:11px;color:white;font-weight:600;">PACK SIZE</th>
          <th style="padding:10px 14px;text-align:right;font-size:11px;color:rgba(255,255,255,0.9);font-weight:600;">UNIT PRICE</th>
          <th style="padding:10px 14px;text-align:right;font-size:11px;color:rgba(255,255,255,0.9);font-weight:600;">LINE TOTAL</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <!-- Reply + Instructions -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:20px 32px;">
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:18px;">
      <div style="font-size:10px;color:#718096;letter-spacing:2px;font-weight:700;margin-bottom:12px;">VENDOR REPLY — PLEASE COMPLETE</div>
      <table style="width:100%;">
        <tr><td style="padding:7px 0;font-size:12px;color:#4a5568;border-bottom:1px solid #e2e8f0;">Quote Total (USD)</td>
            <td style="padding:7px 0;text-align:right;border-bottom:1px solid #e2e8f0;">$______________</td></tr>
        <tr><td style="padding:7px 0;font-size:12px;color:#4a5568;border-bottom:1px solid #e2e8f0;">Shipping &amp; Handling</td>
            <td style="padding:7px 0;text-align:right;border-bottom:1px solid #e2e8f0;">$______________</td></tr>
        <tr><td style="padding:7px 0;font-size:12px;color:#4a5568;border-bottom:2px solid #2b6cb0;">Other Fees / Taxes</td>
            <td style="padding:7px 0;text-align:right;border-bottom:2px solid #2b6cb0;">$______________</td></tr>
        <tr><td style="padding:9px 0;font-size:14px;font-weight:700;color:#1a202c;">GRAND TOTAL</td>
            <td style="padding:9px 0;text-align:right;font-size:14px;font-weight:700;color:#2b6cb0;">$______________</td></tr>
      </table>

    </div>
    <div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:18px;margin-bottom:14px;">
        <div style="font-size:10px;color:#718096;letter-spacing:2px;font-weight:700;margin-bottom:10px;">QUOTING INSTRUCTIONS</div>
        <div style="font-size:12px;color:#4a5568;line-height:2.1;">
          <div>✓ Provide unit pricing for each item listed</div>
          <div>✓ Note any volume discounts available</div>
          <div>✓ List shipping &amp; handling separately</div>
          <div>✓ Quote valid for 30 days from issue date</div>
          <div>✓ Sign and return by email or post</div>
        </div>
      </div>
      ${companyNotes?`<div style="background:#fffbeb;border:1px solid #f6e05e;border-radius:8px;padding:14px;"><div style="font-size:10px;color:#744210;letter-spacing:2px;font-weight:700;margin-bottom:6px;">SPECIAL NOTES</div><div style="font-size:12px;color:#744210;line-height:1.6;">${companyNotes}</div></div>`:""}
    </div>
  </div>



  <!-- Footer -->
  <div style="background:#1a365d;padding:12px 32px;display:flex;justify-content:space-between;align-items:center;">
    <div style="font-size:10px;color:rgba(255,255,255,0.55);">Generated by InvTrack Medical Pro · ${new Date().toLocaleDateString()}</div>
    <div style="font-size:10px;color:rgba(255,255,255,0.55);">Ref: #${refNum} · Confidential</div>
  </div>

  <script>window.onload=()=>window.print();</script>
  </body></html>`;
  const w = window.open("","_blank","width=900,height=700");
  w.document.write(html); w.document.close();
}

function RFPs({store,update,log,showToast}){
  const [sel,setSel]=useState(null);
  const [mode,setMode]=useState("view"); // view | create | edit
  const [draftRFP,setDraftRFP]=useState({vendorId:"",lines:[],notes:""});
  const [filter,setFilter]=useState("all");

  const rfp=sel?store.rfps.find(r=>r.id===sel):null;
  const rfpV=rfp?store.vendors.find(v=>v.id===rfp.vendorId):null;
  const filtered=store.rfps.filter(r=>filter==="all"||r.status===filter);

  function calcSub(lines){return lines.reduce((s,l)=>s+(l.qty*(parseFloat(l.unitPrice)||0)),0);}

  function saveRFP(){
    if(!draftRFP.vendorId)return showToast("Select a vendor",T.amber);
    if(!draftRFP.lines.length)return showToast("Add at least one line item",T.amber);
    const subtotal=calcSub(draftRFP.lines);
    if(mode==="create"){
      const newId=uid();
      const obj={...draftRFP,id:newId,status:"Draft",subtotal,createdAt:now()};
      update(s=>{s.rfps=[obj,...s.rfps];return s;});
      log("RFP created for "+(store.vendors.find(v=>v.id===draftRFP.vendorId)?.name||""));
      showToast("Quote Request created");
      setSel(newId);setMode("view");setDraftRFP({vendorId:"",lines:[],notes:""});
    } else {
      update(s=>{s.rfps=s.rfps.map(r=>r.id===sel?{...r,...draftRFP,subtotal}:r);return s;});
      log("RFP updated");showToast("Quote Request updated");setMode("view");
    }
  }

  function startEdit(){
    setDraftRFP({vendorId:rfp.vendorId,lines:rfp.lines.map(l=>({...l})),notes:rfp.notes||""});
    setMode("edit");
  }

  function deleteRFP(id){
    if(!confirm("Delete this Quote Request?"))return;
    update(s=>{s.rfps=s.rfps.filter(r=>r.id!==id);return s;});
    setSel(null);setMode("view");showToast("Deleted",T.red);
  }

  function upd(id,patch){update(s=>{s.rfps=s.rfps.map(r=>r.id===id?{...r,...patch}:r);return s;});}

  // ── Line editor (shared for create + edit) ──────────────────────────────
  function LineEditor({draft,setDraft}){
    const vendor=store.vendors.find(v=>v.id===draft.vendorId);
    const vp=vendor?.products||[];
    const st=calcSub(draft.lines);
    function ul(id,patch){setDraft(d=>({...d,lines:d.lines.map(l=>l.id===id?{...l,...patch}:l)}));}
    function addLine(){
      if(!vendor)return showToast("Select a vendor first",T.amber);
      if(!vp.length)return showToast("Add products to this vendor first",T.amber);
      const p=vp[0];
      const fullName=p.name+(p.strength&&!p.name.includes(p.strength)?" - "+p.strength:"");
      setDraft(d=>({...d,lines:[...d.lines,{id:uid(),productId:p.id,productName:fullName,sku:p.sku,strength:p.strength,unitPrice:parseFloat(p.price||0),qty:1}]}));
    }
    const th={textAlign:"left",padding:"7px 10px",fontSize:11,color:T.textMid,fontFamily:T.mono,borderBottom:`1px solid ${T.border}`,fontWeight:600,background:T.bgCard};
    return(
      <div>
        <div style={{marginBottom:16}}>
          <Lbl>Vendor</Lbl>
          <select value={draft.vendorId} onChange={e=>setDraft(d=>({...d,vendorId:e.target.value,lines:[]}))} style={IS}>
            <option value="">Select vendor...</option>
            {store.vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        {vendor&&<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <Lbl>Line Items ({draft.lines.length})</Lbl>
            <Btn small onClick={addLine}>+ Add Line</Btn>
          </div>
          {draft.lines.length>0&&(
            <div style={{border:`1px solid ${T.border}`,borderRadius:T.radius,overflow:"hidden",marginBottom:16}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr>
                  {["Product","SKU","Strength","Unit Price","Qty","Line Total",""].map(h=>
                    <th key={h} style={th}>{h}</th>
                  )}
                </tr></thead>
                <tbody>{draft.lines.map(l=>(
                  <tr key={l.id} style={{borderBottom:`1px solid ${T.border}`}}>
                    <td style={{padding:"6px 8px"}}>
                      <select value={l.productId||""} onChange={e=>{
                          const p=vp.find(pp=>pp.id===e.target.value);
                          if(p){
                            const fn=p.name+(p.strength&&!p.name.includes(p.strength)?" - "+p.strength:"");
                            ul(l.id,{productId:p.id,productName:fn,sku:p.sku,strength:p.strength,unitPrice:parseFloat(p.price||0)});
                          }
                        }} style={{...IS,padding:"4px 8px",fontSize:12}}>
                        <option value="">— Select product —</option>
                        {vp.map(p=>{
                          const displayName=p.name+(p.strength&&!p.name.includes(p.strength)?" - "+p.strength:"");
                          return <option key={p.id} value={p.id}>{displayName}</option>;
                        })}
                      </select>
                    </td>
                    <td style={{padding:"6px 8px",fontSize:12,color:T.textMid,fontFamily:T.mono}}>{l.sku}</td>
                    <td style={{padding:"6px 8px",fontSize:12,color:T.textMid}}>{l.strength||"-"}</td>
                    <td style={{padding:"6px 8px"}}>
                      <input type="number" min="0" step="0.01" value={l.unitPrice} onChange={e=>ul(l.id,{unitPrice:parseFloat(e.target.value)||0})} style={{...IS,width:80,padding:"4px 8px"}}/>
                    </td>
                    <td style={{padding:"6px 8px"}}>
                      <input type="number" min="1" value={l.qty} onChange={e=>ul(l.id,{qty:parseInt(e.target.value)||1})} style={{...IS,width:60,padding:"4px 8px",textAlign:"center"}}/>
                    </td>
                    <td style={{padding:"6px 8px",fontSize:13,color:T.accent,fontWeight:700}}>${(l.qty*(parseFloat(l.unitPrice)||0)).toFixed(2)}</td>
                    <td style={{padding:"6px 8px",textAlign:"center"}}>
                      <button onClick={()=>setDraft(d=>({...d,lines:d.lines.filter(ll=>ll.id!==l.id)}))} style={{background:"none",border:"none",color:T.red,cursor:"pointer",fontSize:16,fontWeight:700}}>×</button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div style={{display:"flex",justifyContent:"flex-end",marginBottom:16}}>
            <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.radius,padding:"10px 20px",fontSize:18,fontWeight:700,color:T.accent}}>
              Subtotal: ${st.toFixed(2)}
            </div>
          </div>
        </>}
        <div style={{marginBottom:16}}>
          <Lbl>Notes / Special Instructions</Lbl>
          <textarea value={draft.notes||""} onChange={e=>setDraft(d=>({...d,notes:e.target.value}))} style={{...IS,height:70,resize:"vertical"}} placeholder="Delivery instructions, special requirements..."/>
        </div>
      </div>
    );
  }

  // ── RFP Detail View ───────────────────────────────────────────────────────
  function RFPDetail(){
    const [vt,setVt]=useState(rfp.vendorTotal||"");
    const [sh,setSh]=useState(rfp.shipping||"");
    const sav=rfp.vendorTotal?Math.max(0,rfp.subtotal-parseFloat(rfp.vendorTotal)):0;
    function saveReply(){
      const v=parseFloat(vt),s=parseFloat(sh)||0;
      upd(rfp.id,{vendorTotal:v,shipping:s,savings:Math.max(0,rfp.subtotal-v),status:"Quote Received"});
      showToast("Vendor reply saved");
    }
    const th={textAlign:"left",padding:"8px 12px",fontSize:11,color:T.textMid,fontFamily:T.mono,borderBottom:`1px solid ${T.border}`,fontWeight:600,background:T.bgCard};
    return(
      <div style={{maxWidth:780}}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24,paddingBottom:20,borderBottom:`1px solid ${T.border}`}}>
          <div>
            <div style={{fontSize:10,color:T.accent,fontFamily:T.mono,letterSpacing:2,textTransform:"uppercase",marginBottom:6,fontWeight:600}}>Quote Request Form</div>
            <h2 style={{fontSize:22,fontWeight:700,color:T.text,margin:0}}>{rfpV?.name}</h2>
            <div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,marginTop:4}}>#{rfp.id.slice(0,8).toUpperCase()} · {new Date(rfp.createdAt).toLocaleDateString()}</div>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
            <Btn small onClick={()=>downloadRFPpdf(rfp,rfpV,rfp.notes,store.company)}>⬇ Download PDF</Btn>
            <Btn small ghost onClick={startEdit}>✎ Edit</Btn>
            <Btn small danger onClick={()=>deleteRFP(rfp.id)}>Delete</Btn>
          </div>
        </div>
        {/* Status */}
        <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:20}}>
          <Lbl>Status:</Lbl>
          <select value={rfp.status} onChange={e=>upd(rfp.id,{status:e.target.value})} style={{...IS,width:"auto"}}>
            {RFP_STATUSES.map(s=><option key={s}>{s}</option>)}
          </select>
          <SBadge status={rfp.status}/>
        </div>
        {/* Line Items */}
        <div style={{border:`1px solid ${T.border}`,borderRadius:T.radius,overflow:"hidden",marginBottom:20}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr>{["Product","SKU","Strength","Qty","Vials/Kit"].map(h=><th key={h} style={th}>{h}</th>)}
                <th style={{...th,color:T.amber}}>Est. Price ★</th>
                <th style={{...th,color:T.amber}}>Est. Total ★</th>
              </tr>
              <tr><td colSpan={7} style={{padding:"4px 12px",fontSize:10,color:T.amber,fontStyle:"italic",background:T.amberDim}}>★ Internal estimates only — prices are NOT shown on the vendor PDF</td></tr>
            </thead>
            <tbody>{rfp.lines.map((l,i)=>(
              <tr key={l.id} style={{borderBottom:`1px solid ${T.border}`,background:i%2===0?"transparent":T.bgCard+"80"}}>
                <td style={{padding:"10px 12px",fontSize:13,color:T.text,fontWeight:500}}>{l.productName}</td>
                <td style={{padding:"10px 12px",fontSize:12,color:T.textMid,fontFamily:T.mono}}>{l.sku||"—"}</td>
                <td style={{padding:"10px 12px",fontSize:12,color:T.textMid}}>{l.strength||"—"}</td>
                <td style={{padding:"10px 12px",fontSize:13,color:T.text,fontWeight:600}}>{l.qty}</td>
                <td style={{padding:"10px 12px",fontSize:12,color:T.textMid}}>{l.vials||10} vials</td>
                <td style={{padding:"10px 12px",fontSize:13,color:T.amber}}>${(parseFloat(l.unitPrice)||0).toFixed(2)}</td>
                <td style={{padding:"10px 12px",fontSize:13,color:T.amber,fontWeight:700}}>${(l.qty*(parseFloat(l.unitPrice)||0)).toFixed(2)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:20}}>
          <div style={{background:T.amberDim,border:`1px solid ${T.amber}44`,borderRadius:T.radius,padding:"10px 20px",display:"flex",alignItems:"center",gap:12}}>
            <div style={{fontSize:10,color:T.amber,fontFamily:T.mono,fontWeight:700,letterSpacing:1}}>INTERNAL ESTIMATE</div>
            <span style={{fontSize:20,fontWeight:700,color:T.amber}}>${rfp.subtotal?.toFixed(2)||"0.00"}</span>
          </div>
        </div>
        {/* Vendor Reply + Summary */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:rfp.notes?16:0}}>
          <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.radius,padding:18}}>
            <div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,letterSpacing:1.5,fontWeight:700,marginBottom:14,textTransform:"uppercase"}}>Vendor Reply</div>
            <Lbl>Vendor Total ($)</Lbl>
            <input type="number" value={vt} onChange={e=>setVt(e.target.value)} style={{...IS,marginBottom:10}} placeholder="0.00"/>
            <Lbl>Shipping & Handling ($)</Lbl>
            <input type="number" value={sh} onChange={e=>setSh(e.target.value)} style={{...IS,marginBottom:14}} placeholder="0.00"/>
            <Btn onClick={saveReply}>Save Vendor Reply</Btn>
          </div>
          <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.radius,padding:18}}>
            <div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,letterSpacing:1.5,fontWeight:700,marginBottom:14,textTransform:"uppercase"}}>Summary</div>
            {[["Our Estimate",`$${rfp.subtotal?.toFixed(2)||"0.00"}`],rfp.vendorTotal&&["Vendor Quote",`$${parseFloat(rfp.vendorTotal).toFixed(2)}`],rfp.shipping>0&&["Shipping",`$${parseFloat(rfp.shipping).toFixed(2)}`]].filter(Boolean).map(([l,v])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${T.border}`,fontSize:13}}>
                <span style={{color:T.textMid}}>{l}</span>
                <span style={{color:T.text,fontWeight:600}}>{v}</span>
              </div>
            ))}
            {rfp.vendorTotal&&<div style={{display:"flex",justifyContent:"space-between",padding:"12px 0 0",fontSize:18,fontWeight:700}}>
              <span style={{color:T.text}}>Grand Total</span>
              <span style={{color:T.accent}}>${(parseFloat(rfp.vendorTotal)+(parseFloat(rfp.shipping)||0)).toFixed(2)}</span>
            </div>}
            {sav>0&&<div style={{background:T.greenDim,border:`1px solid ${T.green}44`,borderRadius:T.radius,padding:"10px 14px",marginTop:12,display:"flex",justifyContent:"space-between"}}>
              <span style={{color:T.green,fontWeight:600}}>💰 Savings</span>
              <span style={{color:T.green,fontWeight:700,fontSize:16}}>${sav.toFixed(2)}</span>
            </div>}
          </div>
        </div>
        {rfp.notes&&<div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.radius,padding:16}}>
          <div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,letterSpacing:1.5,fontWeight:700,marginBottom:8,textTransform:"uppercase"}}>Notes</div>
          <div style={{fontSize:13,color:T.text,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{rfp.notes}</div>
        </div>}
      </div>
    );
  }

  const isEditing = mode==="create"||mode==="edit";

  return(
    <div style={{display:"flex",height:"100%",overflow:"hidden"}}>
      {/* Sidebar */}
      <div style={{width:280,borderRight:`1px solid ${T.border}`,overflow:"auto",padding:20,flexShrink:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div>
            <div style={{fontSize:10,color:T.textDim,fontFamily:T.mono,letterSpacing:1.5,textTransform:"uppercase",fontWeight:600,marginBottom:2}}>Procurement</div>
            <h3 style={{margin:0,fontSize:15,color:T.text,fontWeight:600}}>Quote Requests</h3>
          </div>
          <Btn small onClick={()=>{setMode("create");setSel(null);setDraftRFP({vendorId:"",lines:[],notes:""});}}>+ New</Btn>
        </div>
        <select value={filter} onChange={e=>setFilter(e.target.value)} style={{...IS,marginBottom:12}}>
          <option value="all">All Statuses</option>
          {RFP_STATUSES.map(s=><option key={s}>{s}</option>)}
        </select>
        {filtered.map(r=>{
          const v=store.vendors.find(vv=>vv.id===r.vendorId);
          return(
            <div key={r.id} style={{marginTop:6}}>
              <div onClick={()=>{setSel(r.id);setMode("view");}}
                style={{padding:"10px 12px",borderRadius:T.radius,cursor:"pointer",background:sel===r.id&&mode==="view"?T.bgPanel:"transparent",border:sel===r.id&&mode==="view"?`1px solid ${T.borderHi}`:"1px solid transparent",transition:"all 0.1s"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:13,color:T.text,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:130}}>{v?.name||"Unknown"}</span>
                  <SBadge status={r.status}/>
                </div>
                <div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,marginTop:3}}>{new Date(r.createdAt).toLocaleDateString()} · {r.lines.length} items · ${r.subtotal?.toFixed(2)||"0.00"}</div>
                <div style={{display:"flex",gap:4,marginTop:6}}>
                  <button onClick={e=>{e.stopPropagation();setSel(r.id);setMode("view");}} style={{fontSize:10,padding:"2px 8px",borderRadius:4,border:`1px solid ${T.border}`,background:"transparent",color:T.textMid,cursor:"pointer",fontFamily:T.font}}>View</button>
                  <button onClick={e=>{e.stopPropagation();setSel(r.id);const rfpToEdit=store.rfps.find(rr=>rr.id===r.id);if(rfpToEdit){setDraftRFP({vendorId:rfpToEdit.vendorId,lines:rfpToEdit.lines.map(l=>({...l})),notes:rfpToEdit.notes||""});setMode("edit");}}} style={{fontSize:10,padding:"2px 8px",borderRadius:4,border:`1px solid ${T.border}`,background:"transparent",color:T.textMid,cursor:"pointer",fontFamily:T.font}}>Edit</button>
                  <button onClick={e=>{e.stopPropagation();if(!confirm("Delete this RFP?"))return;update(s=>{s.rfps=s.rfps.filter(rr=>rr.id!==r.id);return s;});if(sel===r.id){setSel(null);setMode("view");}}} style={{fontSize:10,padding:"2px 8px",borderRadius:4,border:`1px solid ${T.red}44`,background:"transparent",color:T.red,cursor:"pointer",fontFamily:T.font}}>Delete</button>
                </div>
              </div>
            </div>
          );
        })}
        {!filtered.length&&<div style={{color:T.textMid,fontSize:12,marginTop:20,textAlign:"center"}}>No quote requests yet</div>}
      </div>
      {/* Main */}
      <div style={{flex:1,overflow:"auto",padding:"32px 36px"}}>
        {isEditing&&(
          <div style={{maxWidth:740}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24,paddingBottom:20,borderBottom:`1px solid ${T.border}`}}>
              <div>
                <div style={{fontSize:10,color:T.accent,fontFamily:T.mono,letterSpacing:2,textTransform:"uppercase",marginBottom:6,fontWeight:600}}>{mode==="create"?"New Document":"Edit Document"}</div>
                <h2 style={{fontSize:22,fontWeight:700,color:T.text,margin:0}}>{mode==="create"?"New Quote Request":"Edit Quote Request"}</h2>
              </div>
              <Btn ghost onClick={()=>{setMode(sel?"view":"view");setDraftRFP({vendorId:"",lines:[],notes:""});}}>Cancel</Btn>
            </div>
            <LineEditor draft={draftRFP} setDraft={setDraftRFP}/>
            <div style={{display:"flex",gap:10}}>
              <Btn primary onClick={saveRFP}>{mode==="create"?"Create Quote Request":"Save Changes"}</Btn>
              <Btn ghost onClick={()=>{setMode(sel?"view":"view");}}> Cancel</Btn>
            </div>
          </div>
        )}
        {rfp&&mode==="view"&&<RFPDetail/>}
        {!rfp&&mode==="view"&&<div style={{color:T.textMid,marginTop:80,textAlign:"center",fontSize:14}}>Select a quote request or create a new one</div>}
      </div>
    </div>
  );
}

function Inventory({store,update,log,showToast,lowStock,outOfStock}){
  const [sel,setSel]=useState(null);const [form,setForm]=useState(null);const [search,setSearch]=useState("");const [bcText,setBcText]=useState("");
  const item=sel?store.inventory.find(i=>i.id===sel):null;
  const filtered=store.inventory.filter(i=>i.name.toLowerCase().includes(search.toLowerCase())||(i.sku||"").toLowerCase().includes(search.toLowerCase()));
  function save(data){
    const isNew=!data.id;
    if(isNew){data={...data,id:uid(),createdAt:now()};}
    update(s=>{
      if(!isNew)s.inventory=s.inventory.map(i=>i.id===data.id?{...i,...data}:i);
      else s.inventory=[...s.inventory,data];
      return s;
    });
    log("Item \""+data.name+"\" saved");showToast("Item saved");setForm(null);setSel(data.id);
  }
  function adj(id,d){update(s=>{s.inventory=s.inventory.map(i=>i.id===id?{...i,qty:Math.max(0,(i.qty||0)+d)}:i);return s;});}
  function genBarcode(id,text){if(!text)return;const svg=generateBarcodeSVG(text);const enc="data:image/svg+xml;base64,"+btoa(svg);update(s=>{s.inventory=s.inventory.map(i=>i.id===id?{...i,barcodeSvg:enc,barcodeText:text}:i);return s;});showToast("Barcode generated");}
  const sc=i=>{if(!i)return T.textMid;if(i.qty===0)return T.red;if(i.qty<=(i.reorderAt||5))return T.amber;return T.green;};
  return(
    <div style={{display:"flex",height:"100%",overflow:"hidden"}}>
      <div style={{width:280,borderRight:`1px solid ${T.border}`,overflow:"auto",padding:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><h3 style={{margin:0,fontSize:16,color:T.accent,fontWeight:700}}>Inventory</h3><Btn small onClick={()=>{setForm({name:"",sku:"",qty:0,costPrice:0,salePrice:0,strength:"",reorderAt:5,category:""});setSel(null);}}>+ Add</Btn></div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name/SKU..." style={{...IS,marginBottom:8}}/>
        {filtered.map(i=>(
          <div key={i.id} style={{position:"relative",marginTop:6}} className="sidebar-item">
            <div onClick={()=>{setSel(i.id);setForm(null);}} style={{padding:"10px 12px",borderRadius:6,cursor:"pointer",background:sel===i.id?T.bgPanel:"transparent",border:sel===i.id?`1px solid ${T.borderHi}`:"1px solid transparent"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:13,color:T.text,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:160}}>{i.name}</span>
                <span style={{color:sc(i),fontSize:12,fontWeight:700,flexShrink:0}}>{i.qty}</span>
              </div>
              <div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,marginTop:2}}>{i.sku||"No SKU"} · ${parseFloat(i.salePrice||0).toFixed(2)}</div>
              <div style={{display:"flex",gap:4,marginTop:6}}>
                <button onClick={e=>{e.stopPropagation();setSel(i.id);setForm({...i});}} style={{fontSize:10,padding:"2px 8px",borderRadius:4,border:`1px solid ${T.border}`,background:"transparent",color:T.textMid,cursor:"pointer",fontFamily:T.font}}>Edit</button>
                <button onClick={e=>{e.stopPropagation();if(!confirm("Delete "+i.name+"?"))return;update(s=>{s.inventory=s.inventory.filter(ii=>ii.id!==i.id);return s;});if(sel===i.id)setSel(null);}} style={{fontSize:10,padding:"2px 8px",borderRadius:4,border:`1px solid ${T.red}44`,background:"transparent",color:T.red,cursor:"pointer",fontFamily:T.font}}>Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{flex:1,overflow:"auto",padding:"32px 36px"}}>
        {form&&<div style={{maxWidth:560}}>
          <h3 style={{fontSize:20,fontWeight:700,color:T.text,marginBottom:24}}>{form.id?"Edit Item":"New Inventory Item"}</h3>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            {[["name","Product Name"],["sku","SKU"],["category","Category"],["strength","Strength"]].map(([f,l])=><div key={f}><Lbl>{l}</Lbl><input value={form[f]||""} onChange={e=>setForm({...form,[f]:e.target.value})} style={IS}/></div>)}
            {[["qty","Qty on Hand"],["reorderAt","Reorder At"],["costPrice","Cost Price ($)"],["salePrice","Sale Price ($)"]].map(([f,l])=><div key={f}><Lbl>{l}</Lbl><input type="number" value={form[f]||0} onChange={e=>setForm({...form,[f]:parseFloat(e.target.value)||0})} style={IS}/></div>)}
          </div>
          <div style={{display:"flex",gap:10,marginTop:20}}><Btn onClick={()=>save(form)}>Save</Btn><Btn ghost onClick={()=>setForm(null)}>Cancel</Btn></div>
        </div>}
        {item&&!form&&<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
            <div><h2 style={{fontSize:24,fontWeight:700,color:T.text,margin:0}}>{item.name}</h2><div style={{fontSize:12,color:T.textMid,fontFamily:T.mono,marginTop:4,fontWeight:500}}>SKU: {item.sku||"—"} · {item.category||"Uncategorized"}</div></div>
            <div style={{display:"flex",gap:8}}><Btn small onClick={()=>setForm({...item})}>Edit</Btn><Btn small danger onClick={()=>{if(!confirm("Delete?"))return;update(s=>{s.inventory=s.inventory.filter(i=>i.id!==item.id);return s;});setSel(null);}}>Delete</Btn></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16,marginBottom:24}}>
            {[{l:"In Stock",v:item.qty,c:sc(item)},{l:"Cost Price",v:`$${parseFloat(item.costPrice||0).toFixed(2)}`,c:T.accent},{l:"Sale Price",v:`$${parseFloat(item.salePrice||0).toFixed(2)}`,c:T.purple},{l:"Margin",v:item.salePrice&&item.costPrice?`${(((item.salePrice-item.costPrice)/item.salePrice)*100).toFixed(1)}%`:"—",c:T.green},{l:"Reorder At",v:item.reorderAt||5,c:T.textMid},{l:"Strength",v:item.strength||"—",c:T.textMid}].map(k=>(
              <div key={k.l} style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:6,padding:14}}>
                <div style={{fontSize:10,color:T.textMid,fontFamily:T.mono,letterSpacing:1,fontWeight:700}}>{k.l}</div>
                <div style={{fontSize:22,color:k.c,fontWeight:700,marginTop:4}}>{k.v}</div>
              </div>
            ))}
          </div>
          <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,padding:20,marginBottom:20}}>
            <div style={{fontSize:12,color:T.textMid,fontFamily:T.mono,letterSpacing:1,marginBottom:16,fontWeight:700}}>QTY ADJUSTMENT</div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              {[-10,-5,-1,+1,+5,+10].map(d=><button key={d} onClick={()=>adj(item.id,d)} style={{background:d<0?T.redDim:T.greenDim,border:`1px solid ${d<0?T.red+"44":T.green+"44"}`,color:d<0?T.red:T.green,borderRadius:8,padding:"8px 14px",cursor:"pointer",fontSize:14,fontWeight:700,fontFamily:T.mono}}>{d>0?`+${d}`:d}</button>)}
            </div>
          </div>
          <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,padding:20}}>
            <div style={{fontSize:12,color:T.textMid,fontFamily:T.mono,letterSpacing:1,marginBottom:16,fontWeight:700}}>BARCODE GENERATOR</div>
            {item.barcodeSvg&&<img src={item.barcodeSvg} alt="barcode" style={{display:"block",marginBottom:12,background:"white",padding:8,borderRadius:4}}/>}
            <div style={{display:"flex",gap:10}}>
              <input value={bcText||item.barcodeText||item.sku||""} onChange={e=>setBcText(e.target.value)} placeholder="Enter barcode text..." style={{...IS,flex:1}}/>
              <Btn onClick={()=>genBarcode(item.id,bcText||item.barcodeText||item.sku||item.id.slice(0,8))}>Generate</Btn>
            </div>
          </div>
        </>}
        {!item&&!form&&<div style={{color:T.textMid,marginTop:80,textAlign:"center",fontSize:14,fontWeight:500}}>Select an item or add one</div>}
      </div>
    </div>
  );
}

function Clients({store,update,log,showToast}){
  const [sel,setSel]=useState(null);const [form,setForm]=useState(null);const [search,setSearch]=useState("");
  const client=sel?store.clients.find(c=>c.id===sel):null;
  const filtered=store.clients.filter(c=>c.name.toLowerCase().includes(search.toLowerCase()));
  const cInv=client?store.invoices.filter(i=>i.clientId===client.id):[];
  function save(data){
    const isNew=!data.id;
    if(isNew){data={...data,id:uid(),createdAt:now()};}
    update(s=>{
      if(!isNew)s.clients=s.clients.map(c=>c.id===data.id?{...c,...data}:c);
      else s.clients=[...s.clients,data];
      return s;
    });
    log("Client "+data.name+" saved");showToast("Client saved");setForm(null);setSel(data.id);
  }
  return(
    <div style={{display:"flex",height:"100%",overflow:"hidden"}}>
      <div style={{width:260,borderRight:`1px solid ${T.border}`,overflow:"auto",padding:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><h3 style={{margin:0,fontSize:16,color:T.accent,fontWeight:700}}>Clients</h3><Btn small onClick={()=>{setForm({name:"",email:"",phone:"",address:"",notes:""});setSel(null);}}>+ New</Btn></div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{...IS,marginBottom:8}}/>
        {filtered.map(c=>(
          <div key={c.id} style={{marginTop:6}}>
            <div onClick={()=>{setSel(c.id);setForm(null);}} style={{padding:"10px 12px",borderRadius:6,cursor:"pointer",background:sel===c.id?T.bgPanel:"transparent",border:sel===c.id?`1px solid ${T.borderHi}`:"1px solid transparent"}}>
              <div style={{fontSize:13,color:sel===c.id?T.accent:T.text,fontWeight:600}}>{c.name}</div>
              <div style={{fontSize:11,color:T.textMid,marginTop:1}}>{c.email||"No email"}</div>
              <div style={{display:"flex",gap:4,marginTop:6}}>
                <button onClick={e=>{e.stopPropagation();setSel(c.id);setForm({...c});}} style={{fontSize:10,padding:"2px 8px",borderRadius:4,border:`1px solid ${T.border}`,background:"transparent",color:T.textMid,cursor:"pointer",fontFamily:T.font}}>Edit</button>
                <button onClick={e=>{e.stopPropagation();if(!confirm("Delete "+c.name+"?"))return;update(s=>{s.clients=s.clients.filter(cc=>cc.id!==c.id);return s;});if(sel===c.id)setSel(null);}} style={{fontSize:10,padding:"2px 8px",borderRadius:4,border:`1px solid ${T.red}44`,background:"transparent",color:T.red,cursor:"pointer",fontFamily:T.font}}>Delete</button>
              </div>
            </div>
          </div>
        ))}
        {!filtered.length&&<div style={{color:T.textMid,fontSize:12,marginTop:16,textAlign:"center",fontWeight:500}}>No clients yet</div>}
      </div>
      <div style={{flex:1,overflow:"auto",padding:"32px 36px"}}>
        {form&&<div style={{maxWidth:480}}>
          <h3 style={{fontSize:20,fontWeight:700,color:T.text,marginBottom:24}}>{form.id?"Edit Client":"New Client"}</h3>
          {["name","email","phone","address"].map(f=><div key={f} style={{marginBottom:14}}><Lbl>{f.charAt(0).toUpperCase()+f.slice(1)}</Lbl><input value={form[f]||""} onChange={e=>setForm({...form,[f]:e.target.value})} style={IS}/></div>)}
          <Lbl>Notes</Lbl><textarea value={form.notes||""} onChange={e=>setForm({...form,notes:e.target.value})} style={{...IS,height:80,resize:"vertical"}}/>
          <div style={{display:"flex",gap:10,marginTop:16}}><Btn onClick={()=>save(form)}>Save</Btn><Btn ghost onClick={()=>setForm(null)}>Cancel</Btn></div>
        </div>}
        {client&&!form&&<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
            <div><h2 style={{fontSize:24,fontWeight:700,color:T.text,margin:0}}>{client.name}</h2><div style={{fontSize:12,color:T.textMid,fontFamily:T.mono,marginTop:4,fontWeight:500}}>{client.email}{client.phone?` · ${client.phone}`:""}</div></div>
            <div style={{display:"flex",gap:8}}><Btn small onClick={()=>setForm({...client})}>Edit</Btn><Btn small danger onClick={()=>{if(!confirm("Delete?"))return;update(s=>{s.clients=s.clients.filter(c=>c.id!==client.id);return s;});setSel(null);}}>Delete</Btn></div>
          </div>
          <div style={{display:"flex",gap:16,marginBottom:24}}>
            {[{l:"Total Invoices",v:cInv.length},{l:"Total Billed",v:`$${cInv.reduce((s,i)=>s+i.total,0).toFixed(2)}`},{l:"Paid",v:`$${cInv.filter(i=>i.status==="Paid").reduce((s,i)=>s+i.total,0).toFixed(2)}`}].map(k=><div key={k.l} style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:6,padding:"14px 20px"}}><div style={{fontSize:10,color:T.textMid,fontFamily:T.mono,fontWeight:700}}>{k.l}</div><div style={{fontSize:20,color:T.accent,fontWeight:700}}>{k.v}</div></div>)}
          </div>
          <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,padding:20}}>
            <div style={{fontSize:12,color:T.textMid,fontFamily:T.mono,letterSpacing:1,marginBottom:12,fontWeight:700}}>INVOICES</div>
            {cInv.map(inv=><div key={inv.id} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${T.border}`,fontSize:13}}>
              <span style={{color:T.textMid,fontFamily:T.mono,fontWeight:500}}>#{inv.id.slice(0,8).toUpperCase()}</span>
              <span style={{color:T.text,fontWeight:500}}>{new Date(inv.createdAt).toLocaleDateString()}</span>
              <span style={{color:T.accent,fontWeight:700}}>${inv.total.toFixed(2)}</span>
              <SBadge status={inv.status}/>
            </div>)}
            {!cInv.length&&<div style={{color:T.textMid,fontSize:13,fontWeight:500}}>No invoices</div>}
          </div>
        </>}
        {!client&&!form&&<div style={{color:T.textMid,marginTop:80,textAlign:"center",fontSize:14,fontWeight:500}}>Select a client or create one</div>}
      </div>
    </div>
  );
}

// ── Invoice PDF Export ────────────────────────────────────────────────────────
function downloadInvoicePDF(inv, client, company) {
  const co = company || { name: "Pura Research Labs LLC", email: "phil@puraresearchlabs.com", phone: "+1-239-506-3434", address: "1242 SW Pine Island Rd, Suite 42-291, Cape Coral, FL 33991 USA" };
  const date = new Date(inv.createdAt).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});
  const refNum = inv.id.slice(0,8).toUpperCase();
  const rows = inv.lines.map((l,i) =>
    `<tr style="background:${i%2===0?"#f8fafc":"#ffffff"}">
      <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#1a202c;font-weight:500">${l.productName}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#4a5568;font-family:monospace">${l.sku||"—"}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#4a5568">${l.strength||"—"}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#1a202c;text-align:center;font-weight:600">${l.qty}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#2b6cb0;text-align:right">$${parseFloat(l.unitPrice).toFixed(2)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#2b6cb0;font-weight:700;text-align:right">$${(l.qty*parseFloat(l.unitPrice)).toFixed(2)}</td>
    </tr>`
  ).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Segoe UI',Arial,sans-serif;color:#1a202c;background:#fff;}@page{margin:18mm 20mm;}@media print{body{padding:0;}}</style>
  </head><body>
  <div style="background:linear-gradient(135deg,#1a365d 0%,#2b6cb0 100%);padding:28px 36px;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="display:flex;align-items:center;margin-bottom:8px;">
          <div style="width:36px;height:36px;background:rgba(255,255,255,0.2);border-radius:8px;display:inline-flex;align-items:center;justify-content:center;margin-right:12px;">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2L10 18M2 10L18 10" stroke="white" stroke-width="2.5" stroke-linecap="round"/><circle cx="10" cy="10" r="3" fill="white"/></svg>
          </div>
          <span style="font-size:20px;font-weight:700;color:white;">INVTRACK</span>
          <span style="font-size:10px;color:rgba(255,255,255,0.6);margin-left:8px;letter-spacing:2px;">MEDICAL PRO</span>
        </div>
        <div style="font-size:30px;font-weight:700;color:white;letter-spacing:-0.5px;">INVOICE</div>
      </div>
      <div style="text-align:right;background:rgba(255,255,255,0.15);border-radius:8px;padding:16px 20px;">
        <div style="font-size:10px;color:rgba(255,255,255,0.6);letter-spacing:2px;margin-bottom:4px;">INVOICE NO.</div>
        <div style="font-size:20px;font-weight:700;color:white;font-family:monospace;">#${refNum}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-top:6px;">${date}</div>
      </div>
    </div>
  </div>
  <div style="background:#ebf4ff;border-bottom:2px solid #bee3f8;padding:10px 36px;display:flex;gap:32px;">
    <div><span style="font-size:10px;color:#2c5282;letter-spacing:1px;font-weight:700;">STATUS</span><span style="margin-left:8px;background:#2b6cb0;color:white;border-radius:12px;padding:2px 10px;font-size:11px;font-weight:600;">${inv.status}</span></div>
    <div><span style="font-size:10px;color:#2c5282;letter-spacing:1px;font-weight:700;">DUE DATE</span><span style="margin-left:8px;font-size:12px;color:#2d3748;font-weight:600;">${inv.dueDate||"Net 30"}</span></div>
    <div><span style="font-size:10px;color:#2c5282;letter-spacing:1px;font-weight:700;">ITEMS</span><span style="margin-left:8px;font-size:12px;color:#2d3748;font-weight:600;">${inv.lines.length}</span></div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border-bottom:1px solid #e2e8f0;">
    <div style="padding:20px 36px;border-right:1px solid #e2e8f0;">
      <div style="font-size:10px;color:#718096;letter-spacing:2px;font-weight:700;margin-bottom:10px;">BILL TO</div>
      <div style="font-size:17px;font-weight:700;color:#1a202c;margin-bottom:4px;">${client?.name||"Client"}</div>
      ${client?.email?`<div style="font-size:13px;color:#4a5568;">${client.email}</div>`:""}
      ${client?.phone?`<div style="font-size:13px;color:#4a5568;">${client.phone}</div>`:""}
      ${client?.address?`<div style="font-size:13px;color:#4a5568;margin-top:4px;">${client.address}</div>`:""}
    </div>
    <div style="padding:20px 36px;">
      <div style="font-size:10px;color:#718096;letter-spacing:2px;font-weight:700;margin-bottom:10px;">FROM</div>
      <div style="font-size:14px;font-weight:700;color:#1a202c;margin-bottom:4px;">${co.name}</div>
      ${co.email?`<div style="font-size:12px;color:#2b6cb0;margin-bottom:2px;">${co.email}</div>`:""}
      ${co.phone?`<div style="font-size:12px;color:#4a5568;margin-bottom:2px;">${co.phone}</div>`:""}
      ${co.address?`<div style="font-size:12px;color:#4a5568;margin-bottom:2px;">${co.address}</div>`:""}
      <div style="font-size:13px;color:#4a5568;margin-top:4px;">Invoice Date: ${date}</div>
      ${inv.dueDate?`<div style="font-size:13px;color:#c53030;font-weight:600;margin-top:4px;">Due: ${inv.dueDate}</div>`:""}
    </div>
  </div>
  <div style="padding:24px 36px 0;">
    <div style="font-size:11px;color:#718096;letter-spacing:2px;font-weight:700;margin-bottom:12px;">ITEMS</div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;overflow:hidden;">
      <thead>
        <tr style="background:#2b6cb0;">
          <th style="padding:11px 14px;text-align:left;font-size:11px;color:white;font-weight:600;letter-spacing:0.5px;">PRODUCT NAME</th>
          <th style="padding:11px 14px;text-align:left;font-size:11px;color:white;font-weight:600;">SKU</th>
          <th style="padding:11px 14px;text-align:left;font-size:11px;color:white;font-weight:600;">STRENGTH</th>
          <th style="padding:11px 14px;text-align:center;font-size:11px;color:white;font-weight:600;">QTY</th>
          <th style="padding:11px 14px;text-align:right;font-size:11px;color:white;font-weight:600;">UNIT PRICE</th>
          <th style="padding:11px 14px;text-align:right;font-size:11px;color:white;font-weight:600;">TOTAL</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div style="display:flex;justify-content:flex-end;padding:20px 36px 0;">
    <div style="width:280px;">
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:13px;"><span style="color:#718096;">Subtotal</span><span style="font-weight:600;color:#1a202c;">$${inv.subtotal.toFixed(2)}</span></div>
      ${inv.tax>0?`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:13px;"><span style="color:#718096;">Tax (${inv.taxRate}%)</span><span style="font-weight:600;color:#1a202c;">$${inv.tax.toFixed(2)}</span></div>`:""}
      <div style="display:flex;justify-content:space-between;padding:12px 0;font-size:20px;font-weight:700;border-top:2px solid #2b6cb0;margin-top:4px;"><span style="color:#1a202c;">TOTAL DUE</span><span style="color:#2b6cb0;">$${inv.total.toFixed(2)}</span></div>
    </div>
  </div>
  ${inv.notes?`<div style="margin:20px 36px 0;background:#fffbeb;border:1px solid #f6e05e;border-radius:8px;padding:14px 16px;"><div style="font-size:10px;color:#744210;letter-spacing:2px;font-weight:700;margin-bottom:6px;">NOTES</div><div style="font-size:13px;color:#744210;line-height:1.6;">${inv.notes}</div></div>`:""}
  <div style="margin:24px 36px;border:1px solid #e2e8f0;border-radius:8px;padding:18px;background:#f8fafc;">
    <div style="font-size:11px;color:#718096;letter-spacing:2px;font-weight:700;margin-bottom:12px;">PAYMENT INFORMATION</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;">
      <div><div style="font-size:11px;color:#718096;margin-bottom:4px;">Payment Method</div><div style="border-bottom:1px solid #cbd5e0;height:28px;"></div></div>
      <div><div style="font-size:11px;color:#718096;margin-bottom:4px;">Reference / Check #</div><div style="border-bottom:1px solid #cbd5e0;height:28px;"></div></div>
      <div><div style="font-size:11px;color:#718096;margin-bottom:4px;">Date Paid</div><div style="border-bottom:1px solid #cbd5e0;height:28px;"></div></div>
    </div>
  </div>
  <div style="background:#1a365d;padding:14px 36px;display:flex;justify-content:space-between;align-items:center;">
    <div style="font-size:11px;color:rgba(255,255,255,0.6);">Generated by InvTrack Medical Pro · ${new Date().toLocaleDateString()}</div>
    <div style="font-size:11px;color:rgba(255,255,255,0.6);">Invoice #${refNum} · Thank you for your business</div>
  </div>
  <script>window.onload=()=>window.print();</script>
  </body></html>`;
  const w = window.open("","_blank","width=900,height=700");
  w.document.write(html); w.document.close();
}

function Invoices({store,update,log,showToast}){
  const [sel,setSel]=useState(null);
  const [mode,setMode]=useState("view"); // view | create | edit
  const [draft,setDraft]=useState({clientId:"",lines:[],taxRate:0,dueDate:"",notes:""});
  const [filter,setFilter]=useState("all");

  const inv=sel?store.invoices.find(i=>i.id===sel):null;
  const invClient=inv?store.clients.find(c=>c.id===inv.clientId):null;
  const filtered=store.invoices.filter(i=>filter==="all"||i.status===filter);

  // Build a combined product list from ALL vendors' catalogs + inventory
  const allProducts=[];
  store.vendors.forEach(v=>(v.products||[]).forEach(p=>{
    allProducts.push({id:"v_"+v.id+"_"+p.id,name:p.name,sku:p.sku||"",strength:p.strength||"",price:parseFloat(p.price||0),source:"vendor",vendorName:v.name});
  }));
  store.inventory.forEach(i=>{
    allProducts.push({id:"i_"+i.id,name:i.name,sku:i.sku||"",strength:i.strength||"",price:parseFloat(i.salePrice||0),source:"inventory",qty:i.qty});
  });

  function calcTotals(lines,taxRate){
    const sub=lines.reduce((s,l)=>s+(l.qty*(parseFloat(l.unitPrice)||0)),0);
    const tax=sub*(parseFloat(taxRate||0)/100);
    return{sub,tax,total:sub+tax};
  }

  function ul(id,patch){setDraft(d=>({...d,lines:d.lines.map(l=>l.id===id?{...l,...patch}:l)}));}

  function saveInvoice(){
    if(!draft.clientId)return showToast("Select a client",T.amber);
    if(!draft.lines.length)return showToast("Add at least one line item",T.amber);
    const {sub,tax,total}=calcTotals(draft.lines,draft.taxRate);
    if(mode==="create"){
      const newId=uid();
      const obj={...draft,id:newId,status:"Draft",subtotal:sub,tax,total,createdAt:now()};
      update(s=>{s.invoices=[obj,...s.invoices];return s;});
      log("Invoice created for "+(store.clients.find(c=>c.id===draft.clientId)?.name||""));
      showToast("Invoice created");setSel(newId);setMode("view");setDraft({clientId:"",lines:[],taxRate:0,dueDate:"",notes:""});
    } else {
      update(s=>{s.invoices=s.invoices.map(i=>i.id===sel?{...i,...draft,subtotal:sub,tax,total}:i);return s;});
      log("Invoice updated");showToast("Invoice updated");setMode("view");
    }
  }

  function deleteInvoice(id){
    if(!confirm("Delete this invoice?"))return;
    update(s=>{s.invoices=s.invoices.filter(i=>i.id!==id);return s;});
    setSel(null);setMode("view");showToast("Deleted",T.red);
  }

  const th={textAlign:"left",padding:"8px 12px",fontSize:11,color:T.textMid,fontFamily:T.mono,borderBottom:`1px solid ${T.border}`,fontWeight:600,background:T.bgCard};

  // ── Line Item Editor ───────────────────────────────────────────────────────
  function InvoiceForm(){
    const {sub,tax,total}=calcTotals(draft.lines,draft.taxRate);
    function addLine(){
      setDraft(d=>({...d,lines:[...d.lines,{id:uid(),productId:"",productName:"",sku:"",strength:"",unitPrice:0,qty:1}]}));
    }
    return(
      <div style={{maxWidth:760}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24,paddingBottom:20,borderBottom:`1px solid ${T.border}`}}>
          <div>
            <div style={{fontSize:10,color:T.accent,fontFamily:T.mono,letterSpacing:2,textTransform:"uppercase",marginBottom:6,fontWeight:600}}>{mode==="create"?"New Document":"Edit Document"}</div>
            <h2 style={{fontSize:22,fontWeight:700,color:T.text,margin:0}}>{mode==="create"?"New Invoice":"Edit Invoice"}</h2>
          </div>
          <Btn ghost onClick={()=>setMode("view")}>Cancel</Btn>
        </div>
        {/* Invoice details */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24}}>
          <div>
            <Lbl>Client</Lbl>
            <select value={draft.clientId} onChange={e=>setDraft(d=>({...d,clientId:e.target.value}))} style={IS}>
              <option value="">Select client...</option>
              {store.clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <Lbl>Due Date</Lbl>
            <input type="date" value={draft.dueDate} onChange={e=>setDraft(d=>({...d,dueDate:e.target.value}))} style={IS}/>
          </div>
          <div>
            <Lbl>Tax Rate (%)</Lbl>
            <input type="number" min="0" max="100" step="0.1" value={draft.taxRate} onChange={e=>setDraft(d=>({...d,taxRate:e.target.value}))} style={IS} placeholder="0"/>
          </div>
          <div>
            <Lbl>Notes</Lbl>
            <input value={draft.notes} onChange={e=>setDraft(d=>({...d,notes:e.target.value}))} style={IS} placeholder="Payment terms, special instructions..."/>
          </div>
        </div>
        {/* Line Items */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <Lbl>Line Items ({draft.lines.length})</Lbl>
          <Btn small onClick={addLine}>+ Add Line</Btn>
        </div>
        {draft.lines.length>0&&(
          <div style={{border:`1px solid ${T.border}`,borderRadius:T.radius,overflow:"hidden",marginBottom:16}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr>
                <th style={{...th,width:"38%"}}>Product</th>
                <th style={th}>SKU</th>
                <th style={th}>Strength</th>
                <th style={{...th,width:70}}>Unit $</th>
                <th style={{...th,width:60}}>Qty</th>
                <th style={{...th,textAlign:"right"}}>Total</th>
                <th style={{...th,width:32}}></th>
              </tr></thead>
              <tbody>{draft.lines.map(l=>{
                const lineTotal=l.qty*(parseFloat(l.unitPrice)||0);
                return(
                  <tr key={l.id} style={{borderBottom:`1px solid ${T.border}`}}>
                    <td style={{padding:"6px 8px"}}>
                      {/* Smart dropdown: shows all vendor products + inventory with strength in name */}
                      <select value={l.productId||""} onChange={e=>{
                        if(!e.target.value){ul(l.id,{productId:"",productName:"",sku:"",strength:"",unitPrice:0});return;}
                        const p=allProducts.find(pp=>pp.id===e.target.value);
                        if(p)ul(l.id,{productId:p.id,productName:p.name,sku:p.sku,strength:p.strength,unitPrice:p.price});
                      }} style={{...IS,padding:"5px 8px",fontSize:12,marginBottom:l.productId?"0":"4px"}}>
                        <option value="">— Select product —</option>
                        {store.vendors.filter(v=>(v.products||[]).length>0).map(v=>(
                          <optgroup key={v.id} label={"📦 "+v.name}>
                            {(v.products||[]).map(p=>(
                              <option key={"v_"+v.id+"_"+p.id} value={"v_"+v.id+"_"+p.id}>
                                {p.name}{p.strength&&!(p.name||"").endsWith(p.strength)?" - "+p.strength:""}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                        {store.inventory.length>0&&(
                          <optgroup label="🏥 Inventory">
                            {store.inventory.map(i=>(
                              <option key={"i_"+i.id} value={"i_"+i.id}>
                                {i.name}{i.strength&&!(i.name||"").endsWith(i.strength)?" - "+i.strength:""} (Stock: {i.qty})
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      {!l.productId&&<input value={l.productName} onChange={e=>ul(l.id,{productName:e.target.value})} placeholder="Or type product name..." style={{...IS,padding:"5px 8px",fontSize:12}}/>}
                    </td>
                    <td style={{padding:"6px 8px",fontSize:11,color:T.textMid,fontFamily:T.mono}}>{l.sku||"—"}</td>
                    <td style={{padding:"6px 8px",fontSize:11,color:T.textMid}}>{l.strength||"—"}</td>
                    <td style={{padding:"6px 8px"}}>
                      <input type="number" min="0" step="0.01" value={l.unitPrice} onChange={e=>ul(l.id,{unitPrice:parseFloat(e.target.value)||0})} style={{...IS,width:72,padding:"5px 6px",fontSize:12}}/>
                    </td>
                    <td style={{padding:"6px 8px"}}>
                      <input type="number" min="1" value={l.qty} onChange={e=>ul(l.id,{qty:parseInt(e.target.value)||1})} style={{...IS,width:52,padding:"5px 6px",fontSize:12,textAlign:"center"}}/>
                    </td>
                    <td style={{padding:"6px 12px",fontSize:13,color:T.accent,fontWeight:700,textAlign:"right"}}>${lineTotal.toFixed(2)}</td>
                    <td style={{padding:"6px 8px",textAlign:"center"}}>
                      <button onClick={()=>setDraft(d=>({...d,lines:d.lines.filter(ll=>ll.id!==l.id)}))} style={{background:"none",border:"none",color:T.red,cursor:"pointer",fontSize:18,fontWeight:700,lineHeight:1}}>×</button>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
        {/* Totals */}
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:24}}>
          <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.radius,padding:"14px 20px",minWidth:240}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:6}}>
              <span style={{color:T.textMid}}>Subtotal</span>
              <span style={{color:T.text,fontWeight:600}}>${sub.toFixed(2)}</span>
            </div>
            {parseFloat(draft.taxRate)>0&&<div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:6}}>
              <span style={{color:T.textMid}}>Tax ({draft.taxRate}%)</span>
              <span style={{color:T.text,fontWeight:600}}>${tax.toFixed(2)}</span>
            </div>}
            <div style={{display:"flex",justifyContent:"space-between",fontSize:20,fontWeight:700,borderTop:`1px solid ${T.border}`,paddingTop:10,marginTop:4}}>
              <span style={{color:T.text}}>Total</span>
              <span style={{color:T.accent}}>${total.toFixed(2)}</span>
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:10}}>
          <Btn primary onClick={saveInvoice}>{mode==="create"?"Create Invoice":"Save Changes"}</Btn>
          <Btn ghost onClick={()=>setMode("view")}>Cancel</Btn>
        </div>
      </div>
    );
  }

  // ── Invoice Detail View ────────────────────────────────────────────────────
  function InvoiceDetail(){
    return(
      <div style={{maxWidth:760}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24,paddingBottom:20,borderBottom:`1px solid ${T.border}`}}>
          <div>
            <div style={{fontSize:10,color:T.accent,fontFamily:T.mono,letterSpacing:2,textTransform:"uppercase",marginBottom:6,fontWeight:600}}>Invoice</div>
            <h2 style={{fontSize:22,fontWeight:700,color:T.text,margin:0}}>{invClient?.name||"Unknown Client"}</h2>
            <div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,marginTop:4}}>#{inv.id.slice(0,8).toUpperCase()} · {new Date(inv.createdAt).toLocaleDateString()}</div>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
            <Btn small primary onClick={()=>downloadInvoicePDF(inv,invClient,store.company)}>⬇ Download PDF</Btn>
            <Btn small ghost onClick={()=>{setDraft({clientId:inv.clientId,lines:inv.lines.map(l=>({...l})),taxRate:inv.taxRate||0,dueDate:inv.dueDate||"",notes:inv.notes||""});setMode("edit");}}>✎ Edit</Btn>
            <Btn small danger onClick={()=>deleteInvoice(inv.id)}>Delete</Btn>
          </div>
        </div>
        {/* Status + Due Date */}
        <div style={{display:"flex",gap:16,alignItems:"center",marginBottom:20}}>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <Lbl>Status:</Lbl>
            <select value={inv.status} onChange={e=>update(s=>{s.invoices=s.invoices.map(i=>i.id===inv.id?{...i,status:e.target.value}:i);return s;})} style={{...IS,width:"auto"}}>
              {INV_STATUSES.map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
          <SBadge status={inv.status}/>
          {inv.dueDate&&<div style={{fontSize:12,color:T.textMid}}>Due: <strong style={{color:T.text}}>{inv.dueDate}</strong></div>}
        </div>
        {/* Line Items Table */}
        <div style={{border:`1px solid ${T.border}`,borderRadius:T.radius,overflow:"hidden",marginBottom:20}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>
              <th style={th}>Product</th>
              <th style={th}>SKU</th>
              <th style={th}>Strength</th>
              <th style={{...th,textAlign:"center"}}>Qty</th>
              <th style={{...th,textAlign:"right"}}>Unit Price</th>
              <th style={{...th,textAlign:"right"}}>Total</th>
            </tr></thead>
            <tbody>{inv.lines.map((l,i)=>(
              <tr key={l.id} style={{borderBottom:`1px solid ${T.border}`,background:i%2===0?"transparent":T.bgCard+"60"}}>
                <td style={{padding:"10px 12px",fontSize:13,color:T.text,fontWeight:500}}>{l.productName}</td>
                <td style={{padding:"10px 12px",fontSize:12,color:T.textMid,fontFamily:T.mono}}>{l.sku||"—"}</td>
                <td style={{padding:"10px 12px",fontSize:12,color:T.textMid}}>{l.strength||"—"}</td>
                <td style={{padding:"10px 12px",fontSize:13,color:T.text,fontWeight:600,textAlign:"center"}}>{l.qty}</td>
                <td style={{padding:"10px 12px",fontSize:13,color:T.accent,textAlign:"right"}}>${parseFloat(l.unitPrice).toFixed(2)}</td>
                <td style={{padding:"10px 12px",fontSize:13,color:T.accent,fontWeight:700,textAlign:"right"}}>${(l.qty*parseFloat(l.unitPrice)).toFixed(2)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {/* Totals */}
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:inv.notes?16:0}}>
          <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.radius,padding:"14px 20px",minWidth:260}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"6px 0",borderBottom:`1px solid ${T.border}`}}>
              <span style={{color:T.textMid}}>Subtotal</span>
              <span style={{color:T.text,fontWeight:600}}>${inv.subtotal.toFixed(2)}</span>
            </div>
            {inv.tax>0&&<div style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"6px 0",borderBottom:`1px solid ${T.border}`}}>
              <span style={{color:T.textMid}}>Tax ({inv.taxRate}%)</span>
              <span style={{color:T.text,fontWeight:600}}>${inv.tax.toFixed(2)}</span>
            </div>}
            <div style={{display:"flex",justifyContent:"space-between",fontSize:22,fontWeight:700,paddingTop:10}}>
              <span style={{color:T.text}}>Total Due</span>
              <span style={{color:T.accent}}>${inv.total.toFixed(2)}</span>
            </div>
          </div>
        </div>
        {inv.notes&&<div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.radius,padding:16,marginTop:16}}>
          <div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,letterSpacing:1.5,fontWeight:700,marginBottom:6,textTransform:"uppercase"}}>Notes</div>
          <div style={{fontSize:13,color:T.text,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{inv.notes}</div>
        </div>}
      </div>
    );
  }

  const isEditing=mode==="create"||mode==="edit";

  return(
    <div style={{display:"flex",height:"100%",overflow:"hidden"}}>
      {/* Sidebar */}
      <div style={{width:280,borderRight:`1px solid ${T.border}`,overflow:"auto",padding:20,flexShrink:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div>
            <div style={{fontSize:10,color:T.textDim,fontFamily:T.mono,letterSpacing:1.5,textTransform:"uppercase",fontWeight:600,marginBottom:2}}>Billing</div>
            <h3 style={{margin:0,fontSize:15,color:T.text,fontWeight:600}}>Invoices</h3>
          </div>
          <Btn small onClick={()=>{setMode("create");setSel(null);setDraft({clientId:"",lines:[],taxRate:0,dueDate:"",notes:""});}}>+ New</Btn>
        </div>
        <select value={filter} onChange={e=>setFilter(e.target.value)} style={{...IS,marginBottom:12}}>
          <option value="all">All Statuses</option>
          {INV_STATUSES.map(s=><option key={s}>{s}</option>)}
        </select>
        {filtered.map(i=>{
          const c=store.clients.find(cc=>cc.id===i.clientId);
          return(
            <div key={i.id} style={{marginTop:6}}>
              <div onClick={()=>{setSel(i.id);setMode("view");}}
                style={{padding:"10px 12px",borderRadius:T.radius,cursor:"pointer",background:sel===i.id&&mode==="view"?T.bgPanel:"transparent",border:sel===i.id&&mode==="view"?`1px solid ${T.borderHi}`:"1px solid transparent"}}>
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontSize:13,color:T.text,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:130}}>{c?.name||"Unknown"}</span>
                  <span style={{color:T.accent,fontSize:13,fontWeight:700}}>${i.total.toFixed(2)}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
                  <span style={{fontSize:11,color:T.textMid,fontFamily:T.mono}}>{new Date(i.createdAt).toLocaleDateString()}</span>
                  <SBadge status={i.status}/>
                </div>
                <div style={{display:"flex",gap:4,marginTop:6}}>
                  <button onClick={e=>{e.stopPropagation();setSel(i.id);setMode("view");}} style={{fontSize:10,padding:"2px 8px",borderRadius:4,border:`1px solid ${T.border}`,background:"transparent",color:T.textMid,cursor:"pointer",fontFamily:T.font}}>View</button>
                  <button onClick={e=>{e.stopPropagation();const inv=store.invoices.find(ii=>ii.id===i.id);if(inv){setDraft({clientId:inv.clientId,lines:inv.lines.map(l=>({...l})),taxRate:inv.taxRate||0,dueDate:inv.dueDate||"",notes:inv.notes||""});setSel(i.id);setMode("edit");}}} style={{fontSize:10,padding:"2px 8px",borderRadius:4,border:`1px solid ${T.border}`,background:"transparent",color:T.textMid,cursor:"pointer",fontFamily:T.font}}>Edit</button>
                  <button onClick={e=>{e.stopPropagation();if(!confirm("Delete this invoice?"))return;update(s=>{s.invoices=s.invoices.filter(ii=>ii.id!==i.id);return s;});if(sel===i.id){setSel(null);setMode("view");}}} style={{fontSize:10,padding:"2px 8px",borderRadius:4,border:`1px solid ${T.red}44`,background:"transparent",color:T.red,cursor:"pointer",fontFamily:T.font}}>Delete</button>
                </div>
              </div>
            </div>
          );
        })}
        {!filtered.length&&<div style={{color:T.textMid,fontSize:12,marginTop:16,textAlign:"center"}}>No invoices yet</div>}
      </div>
      {/* Main */}
      <div style={{flex:1,overflow:"auto",padding:"32px 36px"}}>
        {isEditing&&<InvoiceForm/>}
        {inv&&mode==="view"&&<InvoiceDetail/>}
        {!inv&&mode==="view"&&<div style={{color:T.textMid,marginTop:80,textAlign:"center",fontSize:14}}>Select an invoice or create a new one</div>}
      </div>
    </div>
  );
}

function ActivityLog({store,update}){
  function clearLog(){
    if(!confirm("Clear all activity logs?"))return;
    update(s=>{s.activityLog=[];return s;});
  }
  return(
    <div style={{padding:"32px 36px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:28,paddingBottom:20,borderBottom:`1px solid ${T.border}`}}>
        <div>
          <div style={{fontSize:11,color:T.accent,fontFamily:T.mono,letterSpacing:3,textTransform:"uppercase",marginBottom:6,fontWeight:700}}>System</div>
          <h1 style={{fontSize:24,fontWeight:700,color:T.text}}>Activity Log</h1>
        </div>
        <Btn ghost danger onClick={clearLog}>Clear All</Btn>
      </div>
      <div style={{maxWidth:760}}>
        {store.activityLog.map(e=>(
          <div key={e.id} style={{display:"flex",gap:20,padding:"10px 16px",borderBottom:`1px solid ${T.border}`,alignItems:"flex-start"}}>
            <div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,whiteSpace:"nowrap",marginTop:3,minWidth:140,fontWeight:600}}>{new Date(e.at).toLocaleString()}</div>
            <div style={{width:4,height:4,borderRadius:"50%",background:e.type==="warn"?T.amber:T.accent,marginTop:5,flexShrink:0}}/>
            <div style={{fontSize:13,color:e.type==="warn"?T.amber:T.text,fontWeight:500}}>{e.msg}</div>
          </div>
        ))}
        {!store.activityLog.length&&<div style={{fontSize:13,color:T.textMid,padding:"32px 0",textAlign:"center",fontWeight:500}}>No activity recorded yet</div>}
      </div>
    </div>
  );
}

const STORE_KEY="invtrack_store_v1";
const PREFS_KEY="invtrack_prefs_v1";

// Detect environment: Claude artifact uses window.storage, Netlify uses localStorage
const storage={
  async get(key){
    if(typeof window.storage!=="undefined"){
      try{const r=await window.storage.get(key);return r?.value||null;}catch{return null;}
    }
    try{return localStorage.getItem(key);}catch{return null;}
  },
  async set(key,val){
    if(typeof window.storage!=="undefined"){
      try{await window.storage.set(key,val);}catch{}
    } else {
      try{localStorage.setItem(key,val);}catch{}
    }
  }
};

async function loadFromStorage(){
  try{
    const val=await storage.get(STORE_KEY);
    if(val){const parsed=JSON.parse(val);if(parsed&&parsed.vendors)return parsed;}
  }catch(e){}
  return null;
}
async function saveToStorage(data){
  try{await storage.set(STORE_KEY,JSON.stringify(data));}catch(e){}
}
async function loadPrefs(){
  try{
    const val=await storage.get(PREFS_KEY);
    if(val)return JSON.parse(val);
  }catch(e){}
  return {themeMode:"dark",fontChoice:"poppins"};
}
async function savePrefs(prefs){
  try{await storage.set(PREFS_KEY,JSON.stringify(prefs));}catch(e){}
}

export default function App(){
  const [store,setStore]=useState(defaultStore);
  const [tab,setTab]=useState("dashboard");
  const [toast,setToast]=useState(null);
  const [themeMode,setThemeMode]=useState("dark");
  const [fontChoice,setFontChoice]=useState("poppins");
  const [loaded,setLoaded]=useState(false);

  // Load persisted data on mount
  useEffect(()=>{
    Promise.all([loadFromStorage(),loadPrefs()]).then(([savedStore,prefs])=>{
      if(savedStore){
        // Auto-fix bad SKUs: if a SKU contains spaces or is longer than 20 chars it's likely a catalog name not a real SKU
        const cleaned={...savedStore,company:savedStore.company||{name:"Pura Research Labs LLC",email:"phil@puraresearchlabs.com",phone:"+1-239-506-3434",address:"1242 SW Pine Island Rd, Suite 42-291, Cape Coral, FL 33991 USA",website:""},vendors:(savedStore.vendors||[]).map(v=>({
          ...v,
          products:(v.products||[]).map(p=>{
            const sku=p.sku||"";
            const isBadSKU=sku.includes(" ")||sku.length>20;
            return isBadSKU?{...p,sku:""}:p;
          })
        }))};
        setStore(cleaned);
        saveToStorage(cleaned);
      }
      if(prefs){setThemeMode(prefs.themeMode||"dark");setFontChoice(prefs.fontChoice||"poppins");}
      setLoaded(true);
    });
  },[]);

  const fontMap={poppins:"'Poppins',system-ui,sans-serif",roboto:"'Roboto',system-ui,sans-serif"};
  Object.assign(T,buildT(themeMode,fontChoice));
  IS=getIS(); TIER=getTIER(); SC=getSC(T); STATUS_COLORS=Object.fromEntries(Object.entries(SC).map(([k,v])=>[k,v.color]));

  const update=useCallback(fn=>setStore(s=>{
    const copy={...s,vendors:[...s.vendors],clients:[...s.clients],inventory:[...s.inventory],rfps:[...s.rfps],invoices:[...s.invoices],activityLog:[...s.activityLog],company:{...s.company}};
    const next=fn(copy);
    saveToStorage(next);
    return next;
  }),[]);

  const setThemeModeAndSave=(mode)=>{setThemeMode(mode);savePrefs({themeMode:mode,fontChoice});};
  const setFontChoiceAndSave=(font)=>{setFontChoice(font);savePrefs({themeMode,fontChoice:font});};

  const log=useCallback((msg,type="info")=>update(s=>{s.activityLog=[{id:uid(),msg,type,at:now()},...s.activityLog.slice(0,199)];return s;}),[update]);
  const showToast=(msg,color=T.green)=>{setToast({msg,color});setTimeout(()=>setToast(null),3500);};
  const lowStock=store.inventory.filter(i=>i.qty<=(i.reorderAt||5)&&i.qty>0);
  const outOfStock=store.inventory.filter(i=>i.qty===0);
  const alertCount=lowStock.length+outOfStock.length;

  if(!loaded)return(
    <div style={{display:"flex",height:"100vh",background:"#0a0f1a",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:20}}>
      <div style={{position:"relative",width:52,height:52}}>
        <div style={{position:"absolute",inset:0,border:"2px solid rgba(99,179,237,0.15)",borderRadius:"50%"}}/>
        <div style={{position:"absolute",inset:0,border:"2px solid transparent",borderTopColor:"#63b3ed",borderRadius:"50%",animation:"spin 0.9s linear infinite"}}/>
        <div style={{position:"absolute",inset:"12px",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1L8 15M1 8L15 8" stroke="#63b3ed" strokeWidth="2" strokeLinecap="round"/><circle cx="8" cy="8" r="2.5" fill="#63b3ed"/></svg>
        </div>
      </div>
      <div style={{color:"#90afd4",fontFamily:"'Inter',system-ui",fontSize:13,letterSpacing:0.5}}>Loading InvTrack...</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  const GS=`
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Poppins:wght@400;500;600;700&family=Roboto:wght@400;500;700&family=Roboto+Mono:wght@400;500&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    ::-webkit-scrollbar{width:4px;height:4px;}
    ::-webkit-scrollbar-track{background:transparent;}
    ::-webkit-scrollbar-thumb{background:${T.scrollThumb};border-radius:4px;}
    @keyframes pulse-glow{0%,100%{opacity:0.6}50%{opacity:1}}
    @keyframes slide-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes spin{to{transform:rotate(360deg)}}
  `;

  const gridColor=themeMode==="light"?"rgba(0,80,160,0.06)":T.border;

  return(
    <div style={{display:"flex",height:"100vh",background:T.bg,color:T.text,fontFamily:T.font,overflow:"hidden",position:"relative"}}>
      <style>{GS}</style>
      <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:0,backgroundImage:`linear-gradient(${gridColor} 1px,transparent 1px),linear-gradient(90deg,${gridColor} 1px,transparent 1px)`,backgroundSize:"32px 32px"}}/>
      {themeMode==="dark"&&<>
        <div style={{position:"fixed",top:-200,right:-100,width:500,height:500,borderRadius:"50%",background:`radial-gradient(circle,${T.accentDim} 0%,transparent 65%)`,pointerEvents:"none",zIndex:0}}/>
        <div style={{position:"fixed",bottom:-150,left:100,width:400,height:400,borderRadius:"50%",background:"radial-gradient(circle,rgba(79,209,199,0.04) 0%,transparent 65%)",pointerEvents:"none",zIndex:0}}/>
      </>}

      <nav style={{width:240,background:T.bgPanel,borderRight:`1px solid ${T.border}`,display:"flex",flexDirection:"column",flexShrink:0,zIndex:10,position:"relative",boxShadow:themeMode==="light"?`2px 0 20px ${T.shadow}`:`2px 0 20px ${T.shadow}`}}>
        {/* Logo */}
        <div style={{padding:"24px 20px 20px",borderBottom:`1px solid ${T.border}`}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:38,height:38,borderRadius:10,background:`linear-gradient(135deg,${T.accent},${T.teal||T.green})`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:`0 4px 12px ${T.accentGlow}`}}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 2L10 18M2 10L18 10" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
                <circle cx="10" cy="10" r="3" fill="white"/>
              </svg>
            </div>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:T.text,letterSpacing:0.5,fontFamily:T.font}}>InvTrack</div>
              <div style={{fontSize:10,color:T.textMid,fontFamily:T.mono,fontWeight:500,letterSpacing:1}}>MEDICAL PRO</div>
            </div>
          </div>
        </div>
        {/* Nav items */}
        <div style={{flex:1,padding:"12px 10px",display:"flex",flexDirection:"column",gap:1,overflowY:"auto"}}>
          <div style={{fontSize:9,color:T.textDim,fontFamily:T.mono,fontWeight:700,letterSpacing:2,padding:"8px 10px 4px",textTransform:"uppercase"}}>Main Menu</div>
          {NAV.filter(t=>t.id!=="admin").map(t=>{
            const active=tab===t.id;
            return(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"9px 12px",borderRadius:T.radius,background:active?T.accentDim:"transparent",border:"none",color:active?T.accent:T.textMid,cursor:"pointer",fontSize:13,fontWeight:active?600:400,textAlign:"left",fontFamily:T.font,position:"relative",transition:"all 0.15s"}}>
                {active&&<div style={{position:"absolute",left:0,top:"15%",bottom:"15%",width:3,borderRadius:3,background:T.accent}}/>}
                <span style={{fontSize:14,opacity:active?1:0.6,width:18,textAlign:"center"}}>{t.icon}</span>
                <span>{t.label}</span>
                {t.id==="inventory"&&alertCount>0&&<span style={{marginLeft:"auto",background:T.red,color:"white",borderRadius:T.radiusFull||20,fontSize:10,fontWeight:700,padding:"1px 7px",fontFamily:T.mono}}>{alertCount}</span>}
              </button>
            );
          })}
          <div style={{height:1,background:T.border,margin:"8px 10px"}}/>
          <button onClick={()=>setTab("admin")} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"9px 12px",borderRadius:T.radius,background:tab==="admin"?T.accentDim:"transparent",border:"none",color:tab==="admin"?T.accent:T.textDim,cursor:"pointer",fontSize:13,fontWeight:tab==="admin"?600:400,textAlign:"left",fontFamily:T.font}}>
            <span style={{fontSize:14,opacity:0.7,width:18,textAlign:"center"}}>⚙</span>
            <span>Settings</span>
          </button>
        </div>
        {/* Status bar */}
        <div style={{padding:"12px 20px 16px",borderTop:`1px solid ${T.border}`}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:T.green,boxShadow:`0 0 8px ${T.green}`,animation:"pulse-glow 2s ease-in-out infinite",flexShrink:0}}/>
            <span style={{fontSize:11,color:T.green,fontFamily:T.mono,fontWeight:600,letterSpacing:0.5}}>SYSTEM ONLINE</span>
          </div>
          <div style={{fontSize:10,color:T.textDim,fontFamily:T.mono}}>{new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
        </div>
      </nav>

      <main style={{flex:1,overflow:"auto",position:"relative",zIndex:1}}>
        {tab==="dashboard"&&<Dashboard store={store} setTab={setTab} lowStock={lowStock} outOfStock={outOfStock}/>}
        {tab==="vendors"&&<Vendors store={store} update={update} log={log} showToast={showToast}/>}
        {tab==="rfp"&&<RFPs store={store} update={update} log={log} showToast={showToast}/>}
        {tab==="inventory"&&<Inventory store={store} update={update} log={log} showToast={showToast} lowStock={lowStock} outOfStock={outOfStock}/>}
        {tab==="clients"&&<Clients store={store} update={update} log={log} showToast={showToast}/>}
        {tab==="invoices"&&<Invoices store={store} update={update} log={log} showToast={showToast}/>}
        {tab==="log"&&<ActivityLog store={store} update={update}/>}
        {tab==="admin"&&<AdminPanel themeMode={themeMode} setThemeMode={setThemeModeAndSave} fontChoice={fontChoice} setFontChoice={setFontChoiceAndSave} company={store.company||{name:"Pura Research Labs LLC",email:"phil@puraresearchlabs.com",phone:"+1-239-506-3434",address:"1242 SW Pine Island Rd, Suite 42-291, Cape Coral, FL 33991 USA",website:""}} setCompany={co=>{update(s=>{s.company={...co};return s;});showToast("Company details saved");}}/>}
      </main>

      {toast&&<div style={{position:"fixed",bottom:28,right:28,zIndex:9999,background:T.bgPanel,border:`1px solid ${T.border}`,borderLeft:`3px solid ${toast.color}`,color:T.text,padding:"12px 18px",borderRadius:T.radius,fontSize:13,fontFamily:T.font,fontWeight:500,boxShadow:`0 8px 24px ${T.shadow}`,animation:"slide-in 0.2s ease",display:"flex",alignItems:"center",gap:10,maxWidth:360}}>
        <div style={{width:8,height:8,borderRadius:"50%",background:toast.color,flexShrink:0}}/>
        {toast.msg}
      </div>}
    </div>
  );
}
