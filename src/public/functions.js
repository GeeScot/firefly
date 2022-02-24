async function getQuotesNeDB(e) {
  e.preventDefault();
  document.getElementById('quotesbutton').disabled = true;

  const streamer = document.getElementById('streamer').value;
  const inputFile = document.getElementById('quotelist').files[0];

  const formData = new FormData();
  formData.append('streamer', streamer);
  formData.append('quotelist', inputFile);

  try {
    const result = await fetch('/api/quotes/xlsx', {
      method: 'POST',
      body: formData
    });
    const metadata = await result.json();

    setTimeout(() => {
      window.open(`/api/download/quotes/${metadata.createdDb}`, '_blank');
    }, 1000);
  } catch (e) {
    console.log(e);
  } finally {
    document.getElementById('quotesbutton').disabled = false;
  }
}

async function getUsersNeDB(e) {
  e.preventDefault();
  document.getElementById('usersbutton').disabled = true;

  const currencyId = document.getElementById('currencyId').value;
  const inputFile = document.getElementById('userlist').files[0];

  const formData = new FormData();
  formData.append('currencyId', currencyId);
  formData.append('userlist', inputFile);

  try {
    const result = await fetch('/api/users/xlsx', {
      method: 'POST',
      body: formData
    });
    const metadata = await result.json();

    setTimeout(() => {
      window.open(`/api/download/users/${metadata.createdDb}`, '_blank');
    }, 1000);
  } catch (e) {
    console.log(e);
  } finally {
    document.getElementById('usersbutton').disabled = false;
  }
}
