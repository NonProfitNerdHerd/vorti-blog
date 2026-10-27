'use client'
import { useState } from 'react'
import Link from 'next/link'
export default function JoinPage(){
  const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[accepted,setAccepted]=useState(false)
  return <main className="knowledge-workspace"><h1>Join your tenant</h1><p>If you already have an account, <Link href="/admin/login" target="_blank" rel="noreferrer">sign in</Link> first, then return here. Existing credentials will remain unchanged.</p>
    {!accepted&&<form onSubmit={async event=>{event.preventDefault();setBusy(true);try{const response=await fetch('/api/tenant-invitations/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:window.location.hash.slice(1),username,password})});const value=await response.json() as {message?:string};if(!response.ok)throw Error(value.message||'Invitation unavailable.');setAccepted(true);setPassword('');window.history.replaceState(null,'','/join');setMessage('Invitation accepted. Your administrator can now assign your roles.')}catch(cause){setMessage(cause instanceof Error?cause.message:'Invitation unavailable.')}finally{setBusy(false)}}}>
      <label>Username for a new account only<input autoComplete="username" minLength={3} maxLength={32} value={username} onChange={event=>setUsername(event.target.value)}/></label><label>Password for a new account only<input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={event=>setPassword(event.target.value)}/></label><button disabled={busy}>Accept invitation</button>
    </form>}<p role="status">{message}</p>{accepted&&<Link href="/admin/login">Sign in</Link>}
  </main>
}
