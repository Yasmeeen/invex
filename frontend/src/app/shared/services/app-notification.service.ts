export class AppNotificationService {
    push(message: string, type:string){
        let element = document.createElement('div');
        element.classList.add('app-notification');
        element.classList.add(`${type}`);
        element.innerHTML = message;
        element.addEventListener('click', ()=>{
            element.remove();
        })
        document.querySelector('#app-notifications-container')?.prepend(element);
        setTimeout(()=>{
            element.remove();
        }, 7000)
    }
}