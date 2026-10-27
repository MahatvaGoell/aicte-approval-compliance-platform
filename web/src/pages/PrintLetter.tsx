import {useEffect} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link,useParams} from 'react-router-dom';
import {api} from '../api';
import {ErrorState,Loading} from '../ui';
import {LetterDocument} from './CaseLetters';
export function PrintLetterPage(){
 useEffect(()=>{const previous=document.documentElement.dataset.theme;document.documentElement.dataset.theme='light';return ()=>{if(previous)document.documentElement.dataset.theme=previous;else delete document.documentElement.dataset.theme;};},[]);
 const {id='',letterId=''}=useParams();const q=useQuery({queryKey:['case',id],queryFn:()=>api.get<any>(`/applications/${id}`)});
 if(q.isLoading)return <main className="finale-print-page"><Loading/></main>;
 if(q.error)return <main className="finale-print-page"><ErrorState error={q.error} onRetry={()=>q.refetch()}/></main>;
 const letter=q.data?.approvalLetters.find((l:any)=>l.id===letterId);
 if(!letter)return <main className="finale-print-page"><p>Letter not found in this case.</p></main>;
 return <main className="finale-print-page stack"><div className="row finale-no-print"><button onClick={()=>window.print()}>Print letter</button><Link to={`/applications/${id}`}>Return to case</Link><span className="small muted">Demo letter · your active session and case scope are required.</span></div><LetterDocument letter={letter}/></main>;
}
