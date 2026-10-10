import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import type {Lookups} from '@loomos/shared';
import {toast} from 'sonner';
import {api} from '../services/api';
export function useData<T>(path:string,enabled=true){return useQuery({queryKey:[path],queryFn:()=>api<T>(path),enabled});}
export const useLookups=()=>useData<Lookups>('/lookups');
export function useAction(){const client=useQueryClient();return useMutation({mutationFn:({path,body={}}:{path:string;body?:unknown})=>api(path,body),onSuccess:()=>{void client.invalidateQueries();toast.success('Factory workspace updated');},onError:(e)=>toast.error(e.message)});}
